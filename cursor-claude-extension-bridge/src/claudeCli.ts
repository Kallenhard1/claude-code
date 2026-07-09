import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Thin manager around the official `claude` CLI.
 *
 * Phase 1 uses `--output-format text` for a simple prompt -> response
 * round-trip. The public surface (`runPrompt`) is intentionally minimal so
 * Phase 2 can switch to `--output-format stream-json` and emit incremental
 * events without changing callers.
 *
 * The extension never reads, stores, or transmits any Anthropic credential:
 * all auth (the user's Claude subscription via `/login`) lives inside the
 * spawned `claude` process.
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

export interface RunPromptOptions {
  prompt: string;
  cliPath?: string;
  cwd?: string;
  /** Aborts the underlying process when triggered. */
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
  // Empty override -> let the OS resolve `claude` from PATH at spawn time.
  return "claude";
}

/**
 * Heuristic: detect the "not authenticated" state from CLI stderr so we can
 * point the user at `claude` + `/login` instead of surfacing a raw error.
 */
function looksLikeAuthError(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes("not logged in") ||
    s.includes("please run /login") ||
    s.includes("authentication") ||
    s.includes("unauthorized") ||
    s.includes("no api key") ||
    s.includes("invalid api key")
  );
}

/**
 * Run a single prompt through the CLI and resolve with its full text output.
 * Rejects with a {@link ClaudeCliError} describing an actionable failure.
 */
export function runPrompt(options: RunPromptOptions): Promise<string> {
  const command = resolveCliCommand(options.cliPath);
  const cwd = options.cwd?.trim() || process.cwd();

  return new Promise<string>((resolve, reject) => {
    const args = ["-p", options.prompt, "--output-format", "text"];

    let child;
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

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
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
      reject(new ClaudeCliError("spawn-failed", err.message));
    });

    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve(stdout.trim());
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
}

/** Best-effort display name for the resolved CLI, for status/logging. */
export function describeCli(cliPath?: string): string {
  const configured = cliPath?.trim();
  return configured ? path.basename(configured) : "claude (PATH)";
}
