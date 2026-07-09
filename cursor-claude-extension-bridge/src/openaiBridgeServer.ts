import * as vscode from "vscode";
import * as http from "node:http";
import { randomBytes } from "node:crypto";
import {
  ClaudeCliError,
  streamPrompt,
  type StreamEvent,
} from "./claudeCli";
import { BRIDGE_MODELS, resolveCliModel } from "./models";
import { ToolBridgeServer } from "./mcp/toolBridgeServer";

/**
 * A minimal OpenAI-compatible HTTP endpoint (`/v1/models`,
 * `/v1/chat/completions`) that translates requests into runs of the official
 * `claude` CLI and streams the output back as OpenAI chat-completion chunks.
 *
 * This lets Cursor's native chat reach the bridge: register the `-bridge`
 * models (see {@link BRIDGE_MODELS}) as custom OpenAI models in Cursor pointed
 * at this endpoint's base URL. As with the rest of the bridge, no Anthropic
 * credential is ever read here — auth lives inside the spawned `claude`
 * process (the user's `/login` subscription session).
 *
 * NOTE: routing Cursor's chat through a local OpenAI-compatible shim is the
 * "wrap subscription auth as an endpoint" path that `docs/architecture.md`
 * flags as an Anthropic ToS non-goal. It is enabled here at the user's
 * explicit request; keep it opt-in and loopback-only.
 */
export interface OpenAiEndpointInfo {
  url: string;
  port: number;
}

export type ServerState =
  | { status: "stopped" }
  | { status: "listening"; info: OpenAiEndpointInfo }
  | { status: "error"; message: string };

interface ChatMessage {
  role?: string;
  content?: unknown;
}

export class OpenAiBridgeServer implements vscode.Disposable {
  private server?: http.Server;
  private info?: OpenAiEndpointInfo;

  private readonly stateEmitter = new vscode.EventEmitter<ServerState>();
  /** Fires whenever the server starts, stops, or errors — drives the status bar. */
  public readonly onStateChange = this.stateEmitter.event;

  constructor(
    private readonly bridge: ToolBridgeServer,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  public getState(): ServerState {
    return this.info ? { status: "listening", info: this.info } : { status: "stopped" };
  }

  /** Start (or restart) the endpoint from current configuration. Idempotent-ish. */
  public async start(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("claudeCodeBridge");
    const enabled = cfg.get<boolean>("openaiEndpoint.enabled", true);
    if (!enabled) {
      await this.stop();
      return;
    }
    const port = cfg.get<number>("openaiEndpoint.port", 8788);
    if (this.server && this.info?.port === port) {
      return; // Already listening on the desired port.
    }
    await this.stop();

    const server = http.createServer((req, res) => this.handle(req, res));
    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.removeListener("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener("error", onError);
          resolve();
        };
        server.once("error", onError);
        // Loopback only — never exposed off-host.
        server.listen(port, "127.0.0.1", onListening);
      });
    } catch (err) {
      this.server = undefined;
      const message =
        (err as NodeJS.ErrnoException).code === "EADDRINUSE"
          ? `Port ${port} is already in use. Change 'claudeCodeBridge.openaiEndpoint.port'.`
          : (err as Error).message;
      this.log(`endpoint failed to bind on ${port}: ${message}`);
      this.stateEmitter.fire({ status: "error", message });
      return;
    }

    this.info = { port, url: `http://127.0.0.1:${port}/v1` };
    this.log(`endpoint listening on ${this.info.url}`);
    this.stateEmitter.fire({ status: "listening", info: this.info });
  }

  public async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.info = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      this.log("endpoint stopped");
      this.stateEmitter.fire({ status: "stopped" });
    }
  }

  public dispose(): void {
    void this.stop();
    this.stateEmitter.dispose();
  }

  // ---- request routing -----------------------------------------------------

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.log(`→ ${req.method} ${req.url}`);
    const cfg = vscode.workspace.getConfiguration("claudeCodeBridge");
    const requiredKey = cfg.get<string>("openaiEndpoint.apiKey", "").trim();
    if (requiredKey) {
      const auth = req.headers["authorization"];
      if (auth !== `Bearer ${requiredKey}`) {
        this.sendJson(res, 401, {
          error: { message: "invalid api key", type: "invalid_request_error" },
        });
        return;
      }
    }

    const url = (req.url ?? "").split("?")[0];

    if (req.method === "GET" && (url === "/" || url === "/health")) {
      this.sendJson(res, 200, { status: "ok", service: "claude-code-bridge" });
      return;
    }

    if (req.method === "GET" && (url === "/v1/models" || url === "/models")) {
      this.sendJson(res, 200, {
        object: "list",
        data: BRIDGE_MODELS.map((m) => ({
          id: m.id,
          object: "model",
          created: 1700000000,
          owned_by: "claude-code-bridge",
        })),
      });
      return;
    }

    if (
      req.method === "POST" &&
      (url === "/v1/chat/completions" || url === "/chat/completions")
    ) {
      this.readBody(req)
        .then((body) => this.handleChatCompletion(body, req, res, cfg))
        .catch((err) =>
          this.sendJson(res, 400, {
            error: { message: String(err?.message ?? err), type: "invalid_request_error" },
          }),
        );
      return;
    }

    this.sendJson(res, 404, {
      error: { message: `unknown route ${req.method} ${url}`, type: "invalid_request_error" },
    });
  }

  private async handleChatCompletion(
    body: any,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cfg: vscode.WorkspaceConfiguration,
  ): Promise<void> {
    const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : [];
    const prompt = flattenPrompt(messages);
    if (!prompt.trim()) {
      this.sendJson(res, 400, {
        error: { message: "no messages provided", type: "invalid_request_error" },
      });
      return;
    }

    const requestedModel = typeof body?.model === "string" ? body.model : undefined;
    const model = resolveCliModel(requestedModel);
    const stream = body?.stream !== false; // default to streaming, OpenAI-style
    this.log(
      `chat: requested "${requestedModel ?? "(none)"}" → claude --model ${model ?? "(default)"} · stream=${stream} · ${messages.length} msg(s)`,
    );
    const completionId = `chatcmpl-${randomBytes(12).toString("hex")}`;
    const created = Math.floor(Date.now() / 1000);
    const responseModel = requestedModel ?? "opus-4.8-bridge";

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    // Bring up the MCP tool bridge (if enabled and the IDE supports it) so
    // Cursor-chat runs get the same vscode.lm tools the panel does.
    let mcpConfigPath: string | undefined;
    let allowedTools: string[] | undefined;
    if (cfg.get<boolean>("enableToolBridge", true)) {
      try {
        const info = await this.bridge.start();
        if (info) {
          mcpConfigPath = info.mcpConfigPath;
          allowedTools = ["mcp__cursor-bridge"];
        }
      } catch {
        // Tool bridge is best-effort; chat still works without it.
      }
    }
    const extra = cfg
      .get<string[]>("allowedTools", [])
      .map((t) => t.trim())
      .filter(Boolean);
    if (extra.length) {
      allowedTools = [...(allowedTools ?? []), ...extra];
    }

    const cliPath = cfg.get<string>("cliPath", "");
    const cwd =
      cfg.get<string>("cwd", "").trim() ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      "";
    const permissionMode = cfg.get<string>("permissionMode", "default");

    let text = "";
    let started = false;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    if (stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
    }

    const writeChunk = (delta: Record<string, unknown>, finish: string | null) => {
      if (res.writableEnded || res.destroyed) {
        return;
      }
      const chunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: responseModel,
        choices: [{ index: 0, delta, finish_reason: finish }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    };

    const onEvent = (event: StreamEvent) => {
      if (controller.signal.aborted) {
        return;
      }
      if (event.type === "init") {
        // nothing to surface to the OpenAI client
      } else if (event.type === "text-delta") {
        text += event.text;
        if (stream) {
          if (!started) {
            writeChunk({ role: "assistant", content: event.text }, null);
            started = true;
          } else {
            writeChunk({ content: event.text }, null);
          }
        }
      } else if (event.type === "result") {
        inputTokens = event.inputTokens;
        outputTokens = event.outputTokens;
      }
    };

    try {
      const handle = streamPrompt(
        {
          prompt,
          model,
          cliPath,
          cwd,
          permissionMode,
          allowedTools,
          mcpConfigPath,
          signal: controller.signal,
        },
        onEvent,
      );
      await handle.done;
    } catch (err) {
      if (controller.signal.aborted) {
        // Client hung up (Cursor stop / new message). Close quietly.
        if (!res.writableEnded && !res.destroyed) {
          res.end();
        }
        return;
      }
      const message =
        err instanceof ClaudeCliError ? err.message : `Unexpected error: ${(err as Error).message}`;
      this.log(`✗ ${message}`);
      if (stream) {
        if (!started) {
          writeChunk({ role: "assistant", content: `⚠️ ${message}` }, null);
        } else {
          writeChunk({ content: `\n\n⚠️ ${message}` }, null);
        }
        writeChunk({}, "stop");
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        const status = err instanceof ClaudeCliError && err.kind === "not-logged-in" ? 401 : 500;
        this.sendJson(res, status, {
          error: { message, type: "api_error" },
        });
      }
      return;
    }

    this.endStreamOrJson(res, stream, completionId, created, responseModel, text, inputTokens, outputTokens);
  }

  private endStreamOrJson(
    res: http.ServerResponse,
    stream: boolean,
    id: string,
    created: number,
    model: string,
    text: string,
    inputTokens: number | undefined,
    outputTokens: number | undefined,
  ): void {
    if (res.writableEnded || res.destroyed) {
      return;
    }
    const usage = {
      prompt_tokens: inputTokens ?? 0,
      completion_tokens: outputTokens ?? 0,
      total_tokens: (inputTokens ?? 0) + (outputTokens ?? 0),
    };
    if (stream) {
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage,
        })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    this.sendJson(res, 200, {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
      usage,
    });
  }

  private readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
        if (raw.length > 20 * 1024 * 1024) {
          reject(new Error("request body too large"));
          req.destroy();
        }
      });
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(new Error("invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    if (res.writableEnded || res.destroyed) {
      return;
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    const payload = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json" }).end(payload);
  }
}

/** Extract plain text from an OpenAI message `content` (string or parts array). */
function messageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return content == null ? "" : String(content);
}

/**
 * Collapse an OpenAI message array into a single prompt for `claude -p`.
 * A lone user message is passed through verbatim; a multi-turn conversation is
 * serialized with role labels so prior context survives (the CLI runs stateless
 * per request, so the whole transcript is resent each turn — Cursor manages it).
 */
function flattenPrompt(messages: ChatMessage[]): string {
  const nonEmpty = messages
    .map((m) => ({ role: m.role, text: messageText(m.content).trim() }))
    .filter((m) => m.text);
  if (nonEmpty.length === 1 && nonEmpty[0].role === "user") {
    return nonEmpty[0].text;
  }
  return nonEmpty
    .map((m) => {
      const label =
        m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
      return `${label}: ${m.text}`;
    })
    .join("\n\n");
}
