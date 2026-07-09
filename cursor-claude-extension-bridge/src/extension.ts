import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider";
import { ToolBridgeServer } from "./mcp/toolBridgeServer";

export function activate(context: vscode.ExtensionContext): void {
  const bridge = new ToolBridgeServer(context);
  const provider = new ChatViewProvider(context.extensionUri, bridge);

  context.subscriptions.push(
    bridge,
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand("claudeCodeBridge.openChat", () => {
      void vscode.commands.executeCommand("claudeCodeBridge.chat.focus");
    }),
    vscode.commands.registerCommand("claudeCodeBridge.newChat", () => {
      provider.newChat();
    }),
  );
}

export function deactivate(): void {
  // Disposables are handled via context.subscriptions.
}
