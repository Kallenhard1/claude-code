import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Manager around the official `claude` CLI.
 *
 * Uses `--output-format stream-json --include-partial-messages` so the UI can
 * render assistant text token-by-token, show tool activity, and resume
 * sessions with `--resume`. The extension never reads, stores, or transmits
 * any Anthropic credential: all auth (the user's Claude subscription via
 * `/login`) lives inside the spawned `claude` process.
 */

export type ClaudeCliErrorKind =
  | "binary-missing"
  | "not-logged-in"
  | "nonzero-exit"
  | "spawn-failed";

export class ClaudeCliError extends Error {
  constructor(
    public readonly kind: ClaudeCliErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ClaudeCliError";
  }
}

/** Normalized events emitted to the UI, decoupled from the raw NDJSON. */
export type StreamEvent =
  | {
      type: "init";
      sessionId: string;
      model: string;
      tools: string[];
      mcpServers: Array<{ name: string; status?: string }>;
    }
  | { type: "assistant-start" }
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  | { type: "tool-use"; id: string; name: string; input: unknown }
  | { type: "tool-result"; toolUseId: string; text: string; isError: boolean }
  | {
      type: "result";
      sessionId: string;
      isError: boolean;
      costUsd?: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  | { type: "notice"; text: string };

export interface StreamOptions {
  prompt: string;
  cliPath?: string;
  cwd?: string;
  /** Continue an existing conversation. */
  resumeSessionId?: string;
  /** Passed to `--model` (CLI alias like `opus`/`sonnet` or a full model id). */
  model?: string;
  /** Passed to `--permission-mode` when not "default". */
  permissionMode?: string;
  /** Passed to `--allowedTools` (comma-joined). */
  allowedTools?: string[];
  /** Path passed to `--mcp-config`. */
  mcpConfigPath?: string;
  signal?: AbortSignal;
}

/** Resolve the CLI path: explicit override first, otherwise rely on PATH. */
function resolveCliCommand(cliPath?: string): string {
  const configured = cliPath?.trim();
  if (configured) {
    if (!fs.existsSync(configured)) {
      throw new ClaudeCliError(
        "binary-missing",
        `Configured claude CLI path does not exist: ${configured}`,
      );
    }
    return configured;
  }
  return "claude";
}

function looksLikeAuthError(text: string): boolean {
  const s = text.toLowerCase();
  return (
    s.includes("not logged in") ||
    s.includes("please run /login") ||
    s.includes("run `/login`") ||
    s.includes("authentication") ||
    s.includes("unauthorized") ||
    s.includes("invalid api key")
  );
}

/** Extract plain text from a tool_result / message content value. */
function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text ?? "");
        }
        return typeof part === "string" ? part : "";
      })
      .join("");
  }
  return content == null ? "" : String(content);
}

export interface StreamHandle {
  /** Resolves when the CLI process closes cleanly. */
  done: Promise<{ sessionId?: string }>;
}

/**
 * Spawn the CLI for one user turn and emit normalized {@link StreamEvent}s.
 * Rejects `done` with a {@link ClaudeCliError} on an actionable failure.
 */
export function streamPrompt(
  options: StreamOptions,
  onEvent: (event: StreamEvent) => void,
): StreamHandle {
  const command = resolveCliCommand(options.cliPath);
  const cwd = options.cwd?.trim() || process.cwd();

  const args = [
    "-p",
    options.prompt,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
  ];
  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  }
  if (options.model?.trim()) {
    args.push("--model", options.model.trim());
  }
  if (options.permissionMode && options.permissionMode !== "default") {
    args.push("--permission-mode", options.permissionMode);
  }
  if (options.allowedTools?.length) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }
  if (options.mcpConfigPath) {
    args.push("--mcp-config", options.mcpConfigPath);
  }

  const done = new Promise<{ sessionId?: string }>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, {
        cwd,
        signal: options.signal,
        env: process.env,
      });
    } catch (err) {
      reject(
        new ClaudeCliError(
          "spawn-failed",
          `Failed to start the claude CLI: ${(err as Error).message}`,
        ),
      );
      return;
    }

    let stdoutBuffer = "";
    let stderr = "";
    let sessionId: string | undefined = options.resumeSessionId;
    const seenToolUseIds = new Set<string>();

    const translate = (msg: any) => {
      switch (msg?.type) {
        case "system": {
          if (msg.subtype === "init") {
            sessionId = msg.session_id ?? sessionId;
            onEvent({
              type: "init",
              sessionId: msg.session_id ?? "",
              model: msg.model ?? "",
              tools: Array.isArray(msg.tools) ? msg.tools : [],
              mcpServers: Array.isArray(msg.mcp_servers)
                ? msg.mcp_servers.map((s: any) => ({
                    name: s?.name ?? "",
                    status: s?.status,
                  }))
                : [],
            });
          }
          return;
        }
        case "stream_event": {
          const ev = msg.event;
          if (!ev) {
            return;
          }
          if (ev.type === "message_start") {
            onEvent({ type: "assistant-start" });
          } else if (ev.type === "content_block_delta") {
            const delta = ev.delta;
            if (delta?.type === "text_delta" && delta.text) {
              onEvent({ type: "text-delta", text: delta.text });
            } else if (delta?.type === "thinking_delta" && delta.thinking) {
              onEvent({ type: "thinking-delta", text: delta.thinking });
            }
          }
          return;
        }
        case "assistant": {
          // Text is rendered from stream_event deltas; here we only surface
          // fully-formed tool_use blocks (deduped by id).
          const blocks = msg.message?.content;
          if (Array.isArray(blocks)) {
            for (const block of blocks) {
              if (
                block?.type === "tool_use" &&
                block.id &&
                !seenToolUseIds.has(block.id)
              ) {
                seenToolUseIds.add(block.id);
                onEvent({
                  type: "tool-use",
                  id: block.id,
                  name: block.name ?? "tool",
                  input: block.input ?? {},
                });
              }
            }
          }
          return;
        }
        case "user": {
          const blocks = msg.message?.content;
          if (Array.isArray(blocks)) {
            for (const block of blocks) {
              if (block?.type === "tool_result") {
                onEvent({
                  type: "tool-result",
                  toolUseId: block.tool_use_id ?? "",
                  text: contentToText(block.content),
                  isError: Boolean(block.is_error),
                });
              }
            }
          }
          return;
        }
        case "result": {
          sessionId = msg.session_id ?? sessionId;
          onEvent({
            type: "result",
            sessionId: msg.session_id ?? sessionId ?? "",
            isError: Boolean(msg.is_error),
            costUsd:
              typeof msg.total_cost_usd === "number"
                ? msg.total_cost_usd
                : undefined,
            inputTokens: msg.usage?.input_tokens,
            outputTokens: msg.usage?.output_tokens,
          });
          return;
        }
        case "rate_limit_event": {
          const info = msg.rate_limit_info;
          if (info && info.status && info.status !== "allowed") {
            onEvent({
              type: "notice",
              text: `Rate limit (${info.rateLimitType ?? "unknown"}): ${info.status}`,
            });
          }
          return;
        }
        default:
          return;
      }
    };

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      let msg: unknown;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        return; // Non-JSON diagnostic line — ignore.
      }
      translate(msg);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex: number;
      while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        handleLine(line);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new ClaudeCliError(
            "binary-missing",
            `The 'claude' CLI was not found${
              options.cliPath ? "" : " on PATH"
            }. Install Claude Code and run '/login', or set 'claudeCodeBridge.cliPath'.`,
          ),
        );
        return;
      }
      if (options.signal?.aborted) {
        resolve({ sessionId });
        return;
      }
      reject(new ClaudeCliError("spawn-failed", err.message));
    });

    child.on("close", (code: number | null) => {
      if (stdoutBuffer.trim()) {
        handleLine(stdoutBuffer);
        stdoutBuffer = "";
      }
      if (options.signal?.aborted) {
        resolve({ sessionId });
        return;
      }
      if (code === 0) {
        resolve({ sessionId });
        return;
      }
      if (looksLikeAuthError(stderr)) {
        reject(
          new ClaudeCliError(
            "not-logged-in",
            "The claude CLI is not authenticated. Open a terminal, run 'claude', then '/login' with your Claude account.",
          ),
        );
        return;
      }
      reject(
        new ClaudeCliError(
          "nonzero-exit",
          `claude exited with code ${code}.${stderr ? ` ${stderr.trim()}` : ""}`,
        ),
      );
    });
  });

  return { done };
}

/** Best-effort display name for the resolved CLI, for status/logging. */
export function describeCli(cliPath?: string): string {
  const configured = cliPath?.trim();
  return configured ? path.basename(configured) : "claude (PATH)";
}
