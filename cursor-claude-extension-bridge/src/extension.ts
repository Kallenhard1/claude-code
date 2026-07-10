import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider";
import { ToolBridgeServer } from "./mcp/toolBridgeServer";
import { OpenAiBridgeServer, type ServerState } from "./openaiBridgeServer";
import { BRIDGE_MODELS, DEFAULT_MODEL_ID, findBridgeModel } from "./models";
import { BridgeLogger } from "./logger";

export function activate(context: vscode.ExtensionContext): void {
  const bridge = new ToolBridgeServer(context);
  const provider = new ChatViewProvider(context.extensionUri, bridge);
  const logger = new BridgeLogger(context, "Claude Code Bridge");
  const openai = new OpenAiBridgeServer(bridge, (msg) =>
    logger.append(`[endpoint] ${msg}`),
  );

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBar.command = "claudeCodeBridge.selectModel";
  statusBar.show();

  const currentModel = (): string =>
    vscode.workspace
      .getConfiguration("claudeCodeBridge")
      .get<string>("model", DEFAULT_MODEL_ID);

  let lastState: ServerState = { status: "stopped" };
  const renderStatusBar = () => {
    const modelId = currentModel();
    const label = findBridgeModel(modelId)?.label ?? modelId;
    switch (lastState.status) {
      case "listening":
        statusBar.text = `$(broadcast) Claude: ${label}`;
        statusBar.tooltip = new vscode.MarkdownString(
          `**Claude Code Bridge** — endpoint live\n\n` +
            `Model: \`${modelId}\`\n\n` +
            `Base URL: \`${lastState.info.url}\`\n\n` +
            `Add \`${modelId}\` as a custom OpenAI model in Cursor pointed at that URL.\n\n` +
            `_Click to change model._`,
        );
        statusBar.backgroundColor = undefined;
        break;
      case "error":
        statusBar.text = `$(warning) Claude: ${label}`;
        statusBar.tooltip = `Claude Code Bridge endpoint error: ${lastState.message}`;
        statusBar.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        );
        break;
      default:
        statusBar.text = `$(sparkle) Claude: ${label}`;
        statusBar.tooltip = new vscode.MarkdownString(
          `**Claude Code** — model for the chat panel: \`${modelId}\`\n\n` +
            `_Click to switch model._\n\n` +
            `The Cursor-native-chat endpoint is off (opt-in via ` +
            `\`claudeCodeBridge.openaiEndpoint.enabled\`).`,
        );
        statusBar.backgroundColor = undefined;
    }
  };

  context.subscriptions.push(
    openai.onStateChange((state) => {
      lastState = state;
      renderStatusBar();
      if (state.status === "error") {
        void vscode.window.showErrorMessage(
          `Claude Code Bridge endpoint failed: ${state.message}`,
        );
      }
    }),
  );
  renderStatusBar();
  void openai.start();

  context.subscriptions.push(
    bridge,
    openai,
    statusBar,
    logger,
    vscode.commands.registerCommand("claudeCodeBridge.showLog", () => {
      logger.show();
    }),
    vscode.commands.registerCommand("claudeCodeBridge.openLogFile", async () => {
      try {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(logger.filePath),
        );
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Could not open bridge log file (${logger.filePath}): ${(err as Error).message}`,
        );
      }
    }),
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
    vscode.commands.registerCommand("claudeCodeBridge.selectModel", async () => {
      const active = currentModel();
      const pick = await vscode.window.showQuickPick(
        BRIDGE_MODELS.map((m) => ({
          label: m.id === active ? `$(check) ${m.label}` : m.label,
          description: m.id,
          detail: m.detail,
          modelId: m.id,
        })),
        { title: "Claude Code Bridge — Select Model", placeHolder: "Model used by Cursor chat and the panel" },
      );
      if (!pick) {
        return;
      }
      await vscode.workspace
        .getConfiguration("claudeCodeBridge")
        .update("model", pick.modelId, vscode.ConfigurationTarget.Global);
      renderStatusBar();
    }),
    vscode.commands.registerCommand("claudeCodeBridge.restartEndpoint", async () => {
      await openai.start();
    }),
    vscode.commands.registerCommand("claudeCodeBridge.showEndpointInfo", async () => {
      const state = openai.getState();
      if (state.status !== "listening") {
        void vscode.window.showWarningMessage(
          "Claude Code Bridge endpoint is not running. Enable 'claudeCodeBridge.openaiEndpoint.enabled' and reload.",
        );
        return;
      }
      const models = BRIDGE_MODELS.map((m) => `• ${m.id}`).join("\n");
      const choice = await vscode.window.showInformationMessage(
        `Claude Code Bridge endpoint: ${state.info.url}\n\nRegister these as custom OpenAI models in Cursor:\n${models}`,
        { modal: true },
        "Copy Base URL",
      );
      if (choice === "Copy Base URL") {
        await vscode.env.clipboard.writeText(state.info.url);
        void vscode.window.showInformationMessage("Base URL copied to clipboard.");
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("claudeCodeBridge.openaiEndpoint.enabled") ||
        e.affectsConfiguration("claudeCodeBridge.openaiEndpoint.port")
      ) {
        void openai.start();
      }
      if (e.affectsConfiguration("claudeCodeBridge.model")) {
        renderStatusBar();
      }
    }),
  );
}

export function deactivate(): void {
  // Disposables are handled via context.subscriptions.
}
