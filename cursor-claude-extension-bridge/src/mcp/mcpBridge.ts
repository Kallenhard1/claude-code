/**
 * Standalone MCP stdio server, launched by the `claude` CLI via `--mcp-config`.
 *
 * It speaks newline-delimited JSON-RPC 2.0 on stdio (the MCP stdio transport)
 * and proxies `tools/list` / `tools/call` to the extension host's loopback
 * endpoint (see toolBridgeServer.ts), which is what actually reaches the
 * `vscode.lm` tools. This process holds no VS Code APIs itself.
 *
 * It runs under the extension host's own Node runtime (process.execPath with
 * ELECTRON_RUN_AS_NODE=1), so it only uses core `node:` modules.
 */
import * as fs from "node:fs";
import * as http from "node:http";
import { URL } from "node:url";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "cursor-bridge", version: "0.1.0" };

interface BridgeConfig {
  url: string;
  token: string;
}

function loadConfig(): BridgeConfig | undefined {
  const configPath = process.env.CLAUDE_BRIDGE_CONFIG;
  if (!configPath) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.url && parsed?.token) {
      return { url: String(parsed.url), token: String(parsed.token) };
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

function request(
  config: BridgeConfig,
  method: "GET" | "POST",
  routePath: string,
  body?: unknown,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const target = new URL(routePath, config.url);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method,
        headers: {
          authorization: `Bearer ${config.token}`,
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

// ---- JSON-RPC over stdio -------------------------------------------------

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: unknown;
  error?: { code: number; message: string };
}

function send(message: JsonRpcMessage): void {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function reply(id: number | string, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id: number | string, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(
  msg: JsonRpcMessage,
  config: BridgeConfig | undefined,
): Promise<void> {
  const { id, method } = msg;
  // Notifications (no id) require no response.
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize": {
      if (isRequest) {
        reply(id!, {
          protocolVersion: msg.params?.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        });
      }
      return;
    }
    case "notifications/initialized":
      return;
    case "ping": {
      if (isRequest) {
        reply(id!, {});
      }
      return;
    }
    case "tools/list": {
      if (!isRequest) {
        return;
      }
      if (!config) {
        reply(id!, { tools: [] });
        return;
      }
      try {
        const res = await request(config, "GET", "/tools");
        const tools = (res?.tools ?? []).map((t: any) => ({
          name: t.name,
          description: t.description ?? "",
          inputSchema: t.inputSchema ?? { type: "object", properties: {} },
        }));
        reply(id!, { tools });
      } catch (err) {
        replyError(id!, -32603, `bridge unavailable: ${String(err)}`);
      }
      return;
    }
    case "tools/call": {
      if (!isRequest) {
        return;
      }
      if (!config) {
        replyError(id!, -32603, "tool bridge not configured");
        return;
      }
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      try {
        const res = await request(config, "POST", "/invoke", {
          name,
          input: args,
        });
        reply(id!, {
          content: res?.content ?? [{ type: "text", text: "(no output)" }],
          isError: Boolean(res?.isError),
        });
      } catch (err) {
        reply(id!, {
          content: [{ type: "text", text: `Tool bridge error: ${String(err)}` }],
          isError: true,
        });
      }
      return;
    }
    default: {
      if (isRequest) {
        replyError(id!, -32601, `method not found: ${method}`);
      }
      return;
    }
  }
}

function main(): void {
  const config = loadConfig();
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      void handle(msg, config);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

main();
