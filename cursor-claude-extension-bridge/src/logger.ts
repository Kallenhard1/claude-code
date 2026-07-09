import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Tees bridge log lines to both a VS Code {@link vscode.OutputChannel} (shown by
 * the **Claude Code: Show Bridge Log** command) and a persistent file on disk so
 * the log survives window reloads and can be inspected outside the editor.
 *
 * The file lives under the extension's designated log directory
 * (`context.logUri`), which the editor scopes per install and exposes through
 * its "Open Logs Folder" flows. Writes are best-effort: a filesystem failure
 * never breaks the in-memory channel or the request it is logging.
 */
export class BridgeLogger implements vscode.Disposable {
  public readonly channel: vscode.OutputChannel;
  public readonly filePath: string;
  private fileBroken = false;

  constructor(context: vscode.ExtensionContext, channelName: string) {
    this.channel = vscode.window.createOutputChannel(channelName);
    const dir = context.logUri.fsPath;
    this.filePath = path.join(dir, "bridge.log");
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(
        this.filePath,
        `\n=== session started ${new Date().toISOString()} ===\n`,
      );
    } catch (err) {
      this.fileBroken = true;
      this.channel.appendLine(
        `[logger] file logging disabled: ${(err as Error).message}`,
      );
    }
  }

  /** Append a line to the output channel and (best-effort) the log file. */
  public append(msg: string): void {
    this.channel.appendLine(msg);
    if (this.fileBroken) {
      return;
    }
    try {
      fs.appendFileSync(this.filePath, `${new Date().toISOString()} ${msg}\n`);
    } catch (err) {
      // Stop retrying once the file is unwritable, but keep the channel alive.
      this.fileBroken = true;
      this.channel.appendLine(
        `[logger] file logging disabled: ${(err as Error).message}`,
      );
    }
  }

  public show(): void {
    this.channel.show(true);
  }

  public dispose(): void {
    this.channel.dispose();
  }
}
