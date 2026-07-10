import * as vscode from "vscode";
import * as path from "node:path";
import { ChatViewProvider } from "./chatViewProvider";
import { ToolBridgeServer } from "./mcp/toolBridgeServer";
import { OpenAiBridgeServer, type ServerState } from "./openaiBridgeServer";
import {
  BRIDGE_MODELS,
  DEFAULT_MODEL_ID,
  findBridgeModel,
  resolveCliModel,
} from "./models";
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

  /**
   * Build the MCP config snippet a user pastes into Cursor's Agent MCP settings
   * so the native Agent gets an `ask_claude_code` tool. It launches the bundled
   * standalone server with the extension host's own Node runtime (via
   * ELECTRON_RUN_AS_NODE, the same trick the tool bridge uses) — no system
   * `node` required — and forwards the current settings as env defaults. No
   * credential is embedded: auth stays inside the spawned `claude` process.
   */
  const buildAgentMcpConfig = () => {
    const cfg = vscode.workspace.getConfiguration("claudeCodeBridge");
    const scriptPath = context.asAbsolutePath(
      path.join("dist", "ask-claude-server.js"),
    );
    const cwd =
      cfg.get<string>("cwd", "").trim() ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      "";
    const cliModel = resolveCliModel(cfg.get<string>("model", DEFAULT_MODEL_ID));
    const cliPath = cfg.get<string>("cliPath", "").trim();
    const permissionMode = cfg.get<string>("permissionMode", "default");
    const allowedTools = cfg
      .get<string[]>("allowedTools", [])
      .map((t) => t.trim())
      .filter(Boolean);

    const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };
    if (cwd) {
      env.CLAUDE_BRIDGE_CWD = cwd;
    }
    if (cliModel) {
      env.CLAUDE_BRIDGE_MODEL = cliModel;
    }
    if (cliPath) {
      env.CLAUDE_BRIDGE_CLI_PATH = cliPath;
    }
    if (permissionMode && permissionMode !== "default") {
      env.CLAUDE_BRIDGE_PERMISSION_MODE = permissionMode;
    }
    if (allowedTools.length) {
      env.CLAUDE_BRIDGE_ALLOWED_TOOLS = allowedTools.join(",");
    }

    return {
      mcpServers: {
        "claude-code": { command: process.execPath, args: [scriptPath], env },
      },
    };
  };

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
    vscode.commands.registerCommand(
      "claudeCodeBridge.copyAgentMcpConfig",
      async () => {
        const json = JSON.stringify(buildAgentMcpConfig(), null, 2);
        await vscode.env.clipboard.writeText(json);
        const choice = await vscode.window.showInformationMessage(
          "MCP config copied. Paste it into Cursor's MCP settings " +
            "(Cursor Settings → MCP → Add, or a .cursor/mcp.json / ~/.cursor/mcp.json file) " +
            "to give Cursor's native Agent an `ask_claude_code` tool backed by your Claude subscription.",
          "Show Config",
        );
        if (choice === "Show Config") {
          const doc = await vscode.workspace.openTextDocument({
            language: "json",
            content: json,
          });
          await vscode.window.showTextDocument(doc, { preview: true });
        }
      },
    ),
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
