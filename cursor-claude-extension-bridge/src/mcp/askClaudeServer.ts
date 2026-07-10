/**
 * Standalone MCP stdio server that exposes ONE tool — `ask_claude_code` —
 * which delegates a prompt to the official `claude` CLI and returns its answer.
 *
 * This is the *reverse* of `mcpBridge.ts`. Where `mcpBridge.ts` lets the CLI
 * reach the IDE's tools, this server lets an MCP *client* (e.g. Cursor's native
 * Agent, registered via Settings → MCP) reach Claude Code. The client launches
 * this process; on `tools/call` it spawns `claude -p ...`, streams the run, and
 * returns the assistant's text.
 *
 * As everywhere in this project, no Anthropic credential is read, stored, or
 * transmitted: auth (the user's Claude subscription via `/login`) lives entirely
 * inside the spawned `claude` process. Real CLI binary only — never the Agent
 * SDK, never token extraction.
 *
 * It runs under the launcher's Node runtime (the extension ships it to run via
 * `process.execPath` + `ELECTRON_RUN_AS_NODE=1`, so no system `node` is
 * required), and only pulls in `../claudeCli` (itself pure `node:`-modules).
 *
 * Defaults come from env vars the launcher sets (the extension's
 * "Copy Agent MCP Config" command fills these from current settings); per-call
 * `cwd` / `model` arguments override them:
 *   - CLAUDE_BRIDGE_CLI_PATH        → --model resolution / binary path
 *   - CLAUDE_BRIDGE_CWD             → working directory
 *   - CLAUDE_BRIDGE_MODEL           → --model alias (opus | sonnet | haiku)
 *   - CLAUDE_BRIDGE_PERMISSION_MODE → --permission-mode (default: "default")
 *   - CLAUDE_BRIDGE_ALLOWED_TOOLS   → --allowedTools (comma-separated)
 *   - CLAUDE_BRIDGE_TIMEOUT_MS      → abort a run after N ms (default: 600000)
 *   - CLAUDE_BRIDGE_DEBUG           → set truthy to log each call to stderr
 */
import { ClaudeCliError, streamPrompt, type StreamEvent } from "../claudeCli";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "claude-code", version: "0.3.0" };
const DEFAULT_TIMEOUT_MS = 600_000;

const TOOL_NAME = "ask_claude_code";
const TOOL_DEFINITION = {
  name: TOOL_NAME,
  description:
    "Delegate a prompt to Claude Code (the official `claude` CLI) running on " +
    "your Claude subscription — no API key. Claude Code works in the given " +
    "directory and returns its final answer. What it may DO (edit files, run " +
    "commands) is bounded by the server's configured permission mode; in the " +
    "default mode it answers and reads but will not make changes.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The task or question for Claude Code.",
      },
      cwd: {
        type: "string",
        description:
          "Absolute path to the working directory. Defaults to the server's " +
          "configured directory.",
      },
      model: {
        type: "string",
        description:
          "Model to use: opus | sonnet | haiku (or a full model id). Defaults " +
          "to the server's configured model.",
      },
    },
    required: ["prompt"],
  },
} as const;

// ---- config from env -----------------------------------------------------

interface ServerConfig {
  cliPath?: string;
  cwd?: string;
  model?: string;
  permissionMode: string;
  allowedTools?: string[];
  timeoutMs: number;
  debug: boolean;
}

function loadConfig(): ServerConfig {
  const timeoutRaw = Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS);
  const debugRaw = (process.env.CLAUDE_BRIDGE_DEBUG ?? "").trim().toLowerCase();
  return {
    cliPath: process.env.CLAUDE_BRIDGE_CLI_PATH?.trim() || undefined,
    cwd: process.env.CLAUDE_BRIDGE_CWD?.trim() || undefined,
    model: process.env.CLAUDE_BRIDGE_MODEL?.trim() || undefined,
    permissionMode: process.env.CLAUDE_BRIDGE_PERMISSION_MODE?.trim() || "default",
    allowedTools: (process.env.CLAUDE_BRIDGE_ALLOWED_TOOLS ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    timeoutMs:
      Number.isFinite(timeoutRaw) && timeoutRaw > 0
        ? timeoutRaw
        : DEFAULT_TIMEOUT_MS,
    debug: debugRaw !== "" && debugRaw !== "0" && debugRaw !== "false",
  };
}

/**
 * Opt-in diagnostics on **stderr** (never stdout — that carries the JSON-RPC
 * stream). MCP clients such as Cursor surface a server's stderr in their MCP
 * logs, so `CLAUDE_BRIDGE_DEBUG=1` makes each real invocation visible and
 * timestamped — unmistakably distinct from the client model's own output. Only
 * metadata is logged (model, cwd, prompt/answer length, timing), never the
 * prompt text or the answer, and never any credential.
 */
function logDebug(config: ServerConfig, message: string): void {
  if (config.debug) {
    process.stderr.write(
      `[ask_claude_code] ${new Date().toISOString()} ${message}\n`,
    );
  }
}

/** Run one `ask_claude_code` call to completion, collecting the answer text. */
async function runAsk(
  config: ServerConfig,
  args: { prompt?: unknown; cwd?: unknown; model?: unknown },
): Promise<{ text: string; isError: boolean }> {
  const prompt = typeof args?.prompt === "string" ? args.prompt : "";
  if (!prompt.trim()) {
    return { text: "Missing required 'prompt' argument.", isError: true };
  }

  const cwd = typeof args?.cwd === "string" && args.cwd.trim() ? args.cwd.trim() : config.cwd;
  const model =
    typeof args?.model === "string" && args.model.trim() ? args.model.trim() : config.model;

  const startedAt = Date.now();
  logDebug(
    config,
    `call → claude --model ${model ?? "(default)"} · cwd=${cwd ?? "(cwd)"} · ` +
      `permission=${config.permissionMode} · prompt=${prompt.length} chars`,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let text = "";
  let resultIsError = false;
  const notices: string[] = [];

  const onEvent = (event: StreamEvent) => {
    if (event.type === "text-delta") {
      text += event.text;
    } else if (event.type === "result") {
      resultIsError = event.isError;
    } else if (event.type === "notice") {
      notices.push(event.text);
    }
  };

  let runError: string | undefined;
  try {
    const handle = streamPrompt(
      {
        prompt,
        cliPath: config.cliPath,
        cwd,
        model,
        permissionMode: config.permissionMode,
        allowedTools: config.allowedTools,
        signal: controller.signal,
      },
      onEvent,
    );
    await handle.done;
  } catch (err) {
    runError =
      err instanceof ClaudeCliError ? err.message : `Unexpected error: ${String(err)}`;
  } finally {
    clearTimeout(timer);
  }

  const elapsedMs = Date.now() - startedAt;

  // `streamPrompt` resolves (does not reject) when its signal aborts, so the
  // timeout is detected here rather than in the catch above.
  if (controller.signal.aborted) {
    logDebug(config, `timeout after ${config.timeoutMs}ms (${elapsedMs}ms elapsed)`);
    return {
      text: `Claude Code run timed out after ${config.timeoutMs} ms.`,
      isError: true,
    };
  }
  if (runError) {
    logDebug(config, `error in ${elapsedMs}ms: ${runError}`);
    return { text: runError, isError: true };
  }

  const body = text.trim() || "(Claude Code returned no text output.)";
  const footer = notices.length ? `\n\n---\n${notices.join("\n")}` : "";
  logDebug(
    config,
    `done in ${elapsedMs}ms · isError=${resultIsError} · answer=${body.length} chars`,
  );
  return { text: body + footer, isError: resultIsError };
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

async function handle(msg: JsonRpcMessage, config: ServerConfig): Promise<void> {
  const { id, method } = msg;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize": {
      if (isRequest) {
        reply(id!, {
          protocolVersion: PROTOCOL_VERSION,
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
      if (isRequest) {
        reply(id!, { tools: [TOOL_DEFINITION] });
      }
      return;
    }
    case "tools/call": {
      if (!isRequest) {
        return;
      }
      if (msg.params?.name !== TOOL_NAME) {
        replyError(id!, -32602, `unknown tool: ${msg.params?.name}`);
        return;
      }
      const { text, isError } = await runAsk(config, msg.params?.arguments ?? {});
      reply(id!, { content: [{ type: "text", text }], isError });
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
  logDebug(
    config,
    `server ready (${SERVER_INFO.name} v${SERVER_INFO.version}) · ` +
      `default model=${config.model ?? "(claude default)"} · timeout=${config.timeoutMs}ms`,
  );
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
