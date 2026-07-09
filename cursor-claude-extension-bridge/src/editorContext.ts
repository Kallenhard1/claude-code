import * as vscode from "vscode";

/**
 * Build a short IDE-context preamble from the active editor (file path,
 * selection, and diagnostics) to prepend to the user's prompt. Returns an
 * empty string when there is nothing useful to add.
 */
export function buildContextPreamble(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return "";
  }

  const doc = editor.document;
  if (doc.uri.scheme !== "file" && doc.uri.scheme !== "untitled") {
    return "";
  }

  const relPath = vscode.workspace.asRelativePath(doc.uri, false);
  const lines: string[] = ["<ide-context>", `Active file: ${relPath}`];

  const selection = editor.selection;
  if (!selection.isEmpty) {
    const text = doc.getText(selection);
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;
    lines.push(`Selection (lines ${startLine}-${endLine}):`);
    lines.push("```" + doc.languageId);
    lines.push(truncate(text, 4000));
    lines.push("```");
  } else {
    lines.push(`Cursor at line ${selection.active.line + 1}.`);
  }

  const diagnostics = vscode.languages
    .getDiagnostics(doc.uri)
    .filter(
      (d) =>
        d.severity === vscode.DiagnosticSeverity.Error ||
        d.severity === vscode.DiagnosticSeverity.Warning,
    )
    .slice(0, 10);
  if (diagnostics.length) {
    lines.push("Diagnostics:");
    for (const d of diagnostics) {
      const sev =
        d.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning";
      lines.push(`- [${sev}] line ${d.range.start.line + 1}: ${d.message}`);
    }
  }

  lines.push("</ide-context>");
  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\n… (truncated)" : text;
}
