import * as vscode from "vscode";
import {
  ClaudeCliError,
  describeCli,
  streamPrompt,
  type StreamEvent,
} from "./claudeCli";
import { buildContextPreamble } from "./editorContext";
import { ToolBridgeServer, isLmToolsApiAvailable } from "./mcp/toolBridgeServer";

/**
 * Sidebar webview hosting the chat UI. Streams `claude` CLI output into the
 * panel, threads sessions across turns with `--resume`, prepends editor
 * context, and (when available) wires the MCP tool bridge.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "claudeCodeBridge.chat";

  private view?: vscode.WebviewView;
  private inFlight?: AbortController;
  private sessionId?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly bridge: ToolBridgeServer,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message?.type) {
        case "ready":
          this.postStatus();
          break;
        case "prompt":
          void this.handlePrompt(String(message.value ?? ""), Boolean(message.includeContext));
          break;
        case "cancel":
          this.inFlight?.abort();
          break;
      }
    });
  }

  /** Reset the conversation: drop the session id and clear the UI. */
  public newChat(): void {
    this.inFlight?.abort();
    this.sessionId = undefined;
    this.post({ type: "clear" });
    this.postStatus();
  }

  private postStatus(): void {
    const bridgeState = !this.enableToolBridge()
      ? "tool bridge off"
      : isLmToolsApiAvailable()
        ? "tool bridge ready"
        : "tool bridge unavailable in this IDE";
    this.post({
      type: "status",
      value: `${describeCli(this.cliPath())} · ${bridgeState}${
        this.sessionId ? " · session active" : ""
      }`,
    });
  }

  private async handlePrompt(
    prompt: string,
    includeContext: boolean,
  ): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    let finalPrompt = trimmed;
    if (includeContext && this.includeEditorContext()) {
      const preamble = buildContextPreamble();
      if (preamble) {
        finalPrompt = `${preamble}\n\n${trimmed}`;
      }
    }

    // Bring up the tool bridge lazily and pass it to the CLI for this turn.
    let mcpConfigPath: string | undefined;
    let allowedTools: string[] | undefined;
    if (this.enableToolBridge()) {
      try {
        const info = await this.bridge.start();
        if (info) {
          mcpConfigPath = info.mcpConfigPath;
          allowedTools = ["mcp__cursor-bridge"];
        }
      } catch (err) {
        this.post({
          type: "error",
          value: `Tool bridge failed to start: ${(err as Error).message}`,
        });
      }
    }

    const extraAllowed = this.allowedTools();
    if (extraAllowed.length) {
      allowedTools = [...(allowedTools ?? []), ...extraAllowed];
    }

    this.post({ type: "busy", value: true });

    const onEvent = (event: StreamEvent) => {
      if (controller.signal.aborted) {
        return;
      }
      if (event.type === "init" && event.sessionId) {
        this.sessionId = event.sessionId;
      } else if (event.type === "result" && event.sessionId) {
        this.sessionId = event.sessionId;
      }
      this.post({ type: "stream", event });
    };

    try {
      const handle = streamPrompt(
        {
          prompt: finalPrompt,
          cliPath: this.cliPath(),
          cwd: this.cwd(),
          resumeSessionId: this.sessionId,
          permissionMode: this.permissionMode(),
          allowedTools,
          mcpConfigPath,
          signal: controller.signal,
        },
        onEvent,
      );
      await handle.done;
    } catch (err) {
      if (!controller.signal.aborted) {
        const message =
          err instanceof ClaudeCliError
            ? err.message
            : `Unexpected error: ${(err as Error).message}`;
        this.post({ type: "error", value: message });
      }
    } finally {
      if (this.inFlight === controller) {
        this.inFlight = undefined;
      }
      if (!controller.signal.aborted) {
        this.post({ type: "busy", value: false });
      }
      this.postStatus();
    }
  }

  // ---- configuration accessors --------------------------------------------

  private config() {
    return vscode.workspace.getConfiguration("claudeCodeBridge");
  }

  private cliPath(): string {
    return this.config().get<string>("cliPath", "");
  }

  private cwd(): string {
    const configured = this.config().get<string>("cwd", "");
    if (configured.trim()) {
      return configured;
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  }

  private permissionMode(): string {
    return this.config().get<string>("permissionMode", "default");
  }

  private enableToolBridge(): boolean {
    return this.config().get<boolean>("enableToolBridge", true);
  }

  private includeEditorContext(): boolean {
    return this.config().get<boolean>("includeEditorContext", true);
  }

  private allowedTools(): string[] {
    return this.config()
      .get<string[]>("allowedTools", [])
      .map((t) => t.trim())
      .filter(Boolean);
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.css"),
    );

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Claude Code</title>
</head>
<body>
  <div id="status" class="status"></div>
  <div id="messages" class="messages"></div>
  <form id="composer" class="composer">
    <textarea id="input" rows="3" placeholder="Ask Claude Code… (Enter to send, Shift+Enter for newline)"></textarea>
    <div class="composer-row">
      <label class="context-toggle"><input type="checkbox" id="context" checked /> Include editor context</label>
      <div class="composer-actions">
        <button id="cancel" type="button" class="secondary" disabled>Stop</button>
        <button id="send" type="submit">Send</button>
      </div>
    </div>
  </form>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
