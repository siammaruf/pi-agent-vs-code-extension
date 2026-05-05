import * as vscode from 'vscode';
import * as path from 'path';
import type { HostToWebviewMessage, WebviewToHostMessage } from './types.js';

export class PiWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webview?: vscode.Webview;
  private panel?: vscode.WebviewPanel;
  private messageQueue: unknown[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.webview = webviewView.webview;
    this.setupWebview(this.webview);
    webviewView.onDidDispose(() => {
      this.webview = undefined;
    });
    vscode.commands.executeCommand('setContext', 'pi-agent.focused', true);
    webviewView.onDidChangeVisibility(() => {
      vscode.commands.executeCommand('setContext', 'pi-agent.focused', webviewView.visible);
    });
  }

  resolveWebview(webview: vscode.Webview, panel: vscode.WebviewPanel): void {
    this.webview = webview;
    this.panel = panel;
    this.setupWebview(webview);
    panel.onDidDispose(() => {
      this.webview = undefined;
      this.panel = undefined;
      vscode.commands.executeCommand('setContext', 'pi-agent.focused', false);
    });
    vscode.commands.executeCommand('setContext', 'pi-agent.focused', true);
  }

  getWebviewOptions(): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
  }

  postMessage(message: HostToWebviewMessage): void {
    if (this.webview) {
      this.webview.postMessage(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  dispose(): void {
    this.messageQueue = [];
    this.webview = undefined;
    this.panel = undefined;
  }

  private setupWebview(webview: vscode.Webview): void {
    webview.options = this.getWebviewOptions();
    webview.html = this.getHtmlForWebview(webview);

    webview.onDidReceiveMessage(async (message: WebviewToHostMessage) => {
      // Forward to extension.ts handler
      vscode.commands.executeCommand('pi-agent._handleWebviewMessage', message);
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css')
    );
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src https:;">
  <link rel="stylesheet" type="text/css" href="${styleUri}">
  <title>Pi Agent</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  flushQueue(): void {
    if (!this.webview) return;
    while (this.messageQueue.length > 0) {
      this.webview.postMessage(this.messageQueue.shift());
    }
  }
}
