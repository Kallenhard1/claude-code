import * as vscode from "vscode";
import { ClaudeCliError, describeCli, runPrompt } from "./claudeCli";

/**
 * Sidebar webview that hosts the chat UI. Relays user prompts to the `claude`
 * CLI and posts responses/errors back to the webview.
 *
 * Messages (webview -> extension):
 *   { type: "prompt", value: string }
 *   { type: "ready" }
 * Messages (extension -> webview):
 *   { type: "response", value: string }
 *   { type: "error", value: string }
 *   { type: "status", value: string }
 *   { type: "busy", value: boolean }
 *   { type: "clear" }
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "claudeCodeBridge.chat";

  private view?: vscode.WebviewView;
  private inFlight?: AbortController;

  constructor(private readonly extensionUri: vscode.Uri) {}

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
          this.post({
            type: "status",
            value: `Using ${describeCli(this.cliPath())}`,
          });
          break;
        case "prompt":
          void this.handlePrompt(String(message.value ?? ""));
          break;
      }
    });
  }

  /** Clear the conversation surface (Phase 1: stateless, just resets the UI). */
  public newChat(): void {
    this.inFlight?.abort();
    this.post({ type: "clear" });
  }

  private async handlePrompt(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    // Cancel any prior in-flight request before starting a new one.
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    this.post({ type: "busy", value: true });
    try {
      const output = await runPrompt({
        prompt: trimmed,
        cliPath: this.cliPath(),
        cwd: this.cwd(),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        this.post({ type: "response", value: output });
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      const message =
        err instanceof ClaudeCliError
          ? err.message
          : `Unexpected error: ${(err as Error).message}`;
      this.post({ type: "error", value: message });
    } finally {
      if (this.inFlight === controller) {
        this.inFlight = undefined;
      }
      if (!controller.signal.aborted) {
        this.post({ type: "busy", value: false });
      }
    }
  }

  private cliPath(): string {
    return vscode.workspace
      .getConfiguration("claudeCodeBridge")
      .get<string>("cliPath", "");
  }

  private cwd(): string {
    const configured = vscode.workspace
      .getConfiguration("claudeCodeBridge")
      .get<string>("cwd", "");
    if (configured.trim()) {
      return configured;
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
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
    <button id="send" type="submit">Send</button>
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
