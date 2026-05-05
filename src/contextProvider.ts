import * as vscode from 'vscode';

export class ContextProvider {
  /**
   * Get the currently selected text in the active editor.
   */
  getCurrentSelection(): { text: string; file: string; range: [number, number, number, number] } | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;

    const selection = editor.selection;
    if (selection.isEmpty) return undefined;

    const text = editor.document.getText(selection);
    const file = editor.document.uri.toString();
    const range: [number, number, number, number] = [
      selection.start.line,
      selection.start.character,
      selection.end.line,
      selection.end.character,
    ];

    return { text, file, range };
  }

  /**
   * Get the content of the active file.
   */
  getActiveFile(): { uri: string; content: string; language: string } | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;

    return {
      uri: editor.document.uri.toString(),
      content: editor.document.getText(),
      language: editor.document.languageId,
    };
  }

  /**
   * Format context (file + selection) as a prompt prefix.
   */
  formatContext(): string {
    const file = this.getActiveFile();
    const selection = this.getCurrentSelection();

    let context = '';
    if (file) {
      context += `Current file: ${vscode.workspace.asRelativePath(vscode.Uri.parse(file.uri))}\n`;
      if (selection) {
        context += `Selection:\n\`\`\`${file.language}\n${selection.text}\n\`\`\`\n`;
      } else {
        context += `File content:\n\`\`\`${file.language}\n${file.content}\n\`\`\`\n`;
      }
    }
    return context;
  }

  /**
   * List files in the workspace, respecting .gitignore if available.
   */
  async listWorkspaceFiles(): Promise<Array<{ name: string; path: string }>> {
    const files: Array<{ name: string; path: string }> = [];
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return files;

    for (const folder of workspaceFolders) {
      try {
        const pattern = new vscode.RelativePattern(folder, '**/*');
        const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 1000);
        for (const uri of uris) {
          files.push({
            name: vscode.workspace.asRelativePath(uri),
            path: uri.toString(),
          });
        }
      } catch {
        // ignore
      }
    }
    return files;
  }
}
