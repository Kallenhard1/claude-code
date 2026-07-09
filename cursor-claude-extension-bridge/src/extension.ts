import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context.extensionUri);

  context.subscriptions.push(
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
