import * as vscode from "vscode";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Extension-host side of the MCP tool bridge.
 *
 * The `claude` CLI cannot call VS Code APIs, and MCP servers it launches run
 * in their own process. So this class runs a loopback HTTP endpoint inside the
 * extension host that exposes the `vscode.lm` Language Model Tools contributed
 * by *other* extensions. The companion stdio MCP server (`mcpBridge.ts`),
 * launched by the CLI, proxies `tools/list` and `tools/call` to this endpoint.
 *
 * Cursor's own proprietary tools are not part of `vscode.lm` and cannot be
 * bridged — only extension-contributed tools are visible here.
 */
export interface BridgeInfo {
  /** Base URL of the loopback endpoint, e.g. http://127.0.0.1:53812 */
  url: string;
  /** Shared secret required on every request. */
  token: string;
  /** Path to the generated `--mcp-config` file. */
  mcpConfigPath: string;
}

/** Feature-detect the VS Code Language Model Tools API (may be absent in Cursor). */
export function isLmToolsApiAvailable(): boolean {
  const lm = (vscode as { lm?: unknown }).lm as
    | { tools?: unknown; invokeTool?: unknown }
    | undefined;
  return (
    !!lm &&
    Array.isArray(lm.tools) &&
    typeof lm.invokeTool === "function"
  );
}

export class ToolBridgeServer implements vscode.Disposable {
  private server?: http.Server;
  private info?: BridgeInfo;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Start the loopback server and generate the MCP config. Idempotent. */
  public async start(): Promise<BridgeInfo | undefined> {
    if (this.info) {
      return this.info;
    }
    if (!isLmToolsApiAvailable()) {
      return undefined;
    }

    const token = randomBytes(24).toString("hex");
    const server = http.createServer((req, res) =>
      this.handleRequest(req, res, token),
    );
    this.server = server;

    const port = await new Promise<number>((resolve, reject) => {
      server.on("error", reject);
      // Bind to loopback only — never exposed off-host.
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("Failed to determine bridge server port"));
        }
      });
    });

    const url = `http://127.0.0.1:${port}`;
    const storageDir = this.context.globalStorageUri.fsPath;
    fs.mkdirSync(storageDir, { recursive: true });

    // Config file the stdio MCP server reads at startup (stable path, refreshed
    // each activation with the current port/token).
    const bridgeConfigPath = path.join(storageDir, "bridge.json");
    fs.writeFileSync(bridgeConfigPath, JSON.stringify({ url, token }), "utf8");

    // MCP config passed to `claude --mcp-config`. Uses the ext host's own Node
    // runtime (via ELECTRON_RUN_AS_NODE) so no system `node` is required.
    const bridgeEntry = this.context.asAbsolutePath(
      path.join("dist", "mcp-bridge.js"),
    );
    const mcpConfig = {
      mcpServers: {
        "cursor-bridge": {
          command: process.execPath,
          args: [bridgeEntry],
          env: {
            ELECTRON_RUN_AS_NODE: "1",
            CLAUDE_BRIDGE_CONFIG: bridgeConfigPath,
          },
        },
      },
    };
    const mcpConfigPath = path.join(storageDir, "mcp-config.json");
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig), "utf8");

    this.info = { url, token, mcpConfigPath };
    return this.info;
  }

  public getInfo(): BridgeInfo | undefined {
    return this.info;
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    token: string,
  ): void {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${token}`) {
      res.writeHead(401).end("unauthorized");
      return;
    }

    if (req.method === "GET" && req.url === "/tools") {
      this.listTools()
        .then((tools) => this.sendJson(res, 200, { tools }))
        .catch((err) => this.sendJson(res, 500, { error: String(err) }));
      return;
    }

    if (req.method === "POST" && req.url === "/invoke") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let parsed: { name?: string; input?: unknown };
        try {
          parsed = JSON.parse(body || "{}");
        } catch {
          this.sendJson(res, 400, { error: "invalid JSON body" });
          return;
        }
        if (!parsed.name) {
          this.sendJson(res, 400, { error: "missing tool name" });
          return;
        }
        this.invokeTool(parsed.name, parsed.input ?? {})
          .then((result) => this.sendJson(res, 200, result))
          .catch((err) =>
            this.sendJson(res, 200, {
              content: [{ type: "text", text: String(err?.message ?? err) }],
              isError: true,
            }),
          );
      });
      return;
    }

    res.writeHead(404).end("not found");
  }

  private async listTools(): Promise<
    Array<{ name: string; description: string; inputSchema: unknown }>
  > {
    const lm = (vscode as any).lm;
    const tools = (lm?.tools ?? []) as Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
    }>;
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? {
        type: "object",
        properties: {},
      },
    }));
  }

  private async invokeTool(
    name: string,
    input: unknown,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean }> {
    const lm = (vscode as any).lm;
    const cts = new vscode.CancellationTokenSource();
    try {
      const result = await lm.invokeTool(
        name,
        { input, toolInvocationToken: undefined },
        cts.token,
      );
      const parts = (result?.content ?? []) as unknown[];
      const text = parts
        .map((p) => {
          if (p && typeof p === "object" && "value" in p) {
            return String((p as { value: unknown }).value ?? "");
          }
          return typeof p === "string" ? p : "";
        })
        .join("");
      return {
        content: [{ type: "text", text: text || "(no output)" }],
        isError: false,
      };
    } finally {
      cts.dispose();
    }
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    body: unknown,
  ): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" }).end(payload);
  }

  public dispose(): void {
    this.server?.close();
    this.server = undefined;
    this.info = undefined;
  }
}
