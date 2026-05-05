import * as vscode from "vscode";
import type { SessionManager } from "./sessionManager.js";
import type { ConversationSession } from "./types.js";
import { execFile, spawn, type ChildProcess } from "node:child_process";

function findPiBinary(): string {
  const ext = vscode.extensions.getExtension("pi-agent.pi-agent");
  const localPi = ext
    ? vscode.Uri.joinPath(ext.extensionUri, "node_modules", ".bin", "pi").fsPath
    : "";
  const candidates = process.platform === "win32"
    ? [`${localPi}.cmd`, `${localPi}.ps1`, localPi, "pi.cmd", "pi.ps1", "pi"]
    : [localPi, "pi"];
  for (const c of candidates) {
    try {
      require("node:fs").accessSync(c);
      return c;
    } catch { /* ignore */ }
  }
  return "pi";
}

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webview?: vscode.Webview;
  private disposables: vscode.Disposable[] = [];
  private activeTab: "conversations" | "packages" | "settings" = "conversations";
  private packagesProcess?: ChildProcess;
  private installedPackages: { source: string; path: string }[] = [];
  private allPackages: any[] = [];
  private messageQueue: any[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    private readonly onNewConversation: () => void,
    private readonly onOpenConversation: (session: ConversationSession) => void,
    private readonly onDeleteConversation: (id: string) => void,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.webview = webviewView.webview;
    this.webview.options = { enableScripts: true };
    this.webview.html = this.getHtml();

    this.disposables.push(
      this.webview.onDidReceiveMessage((msg) => this.handleMessage(msg))
    );

    this.disposables.push(
      webviewView.onDidDispose(() => {
        if (this.webview === webviewView.webview) {
          this.webview = undefined;
        }
      })
    );
  }

  refreshConversations(): void {
    this.safePostMessage({ type: "conversations", sessions: this.getSessions() });
  }

  private getSessions(): any[] {
    try {
      const all = this.sessionManager.getAll();
      return Array.isArray(all) ? all.slice().sort((a, b) => b.updatedAt - a.updatedAt) : [];
    } catch {
      return [];
    }
  }

  updateSettingsState(state: any): void {
    this.safePostMessage({ type: "settingsState", ...state });
  }

  switchToTab(tab: string): void {
    this.safePostMessage({ type: "switchToTab", tab });
  }

  flushQueue(): void {
    if (!this.webview) return;
    while (this.messageQueue.length > 0) {
      this.webview.postMessage(this.messageQueue.shift());
    }
  }

  private safePostMessage(message: any): void {
    if (this.webview) {
      this.webview.postMessage(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  dispose(): void {
    this.packagesProcess?.kill();
    this.webview = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.messageQueue = [];
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "ready":
        this.flushQueue();
        this.refreshConversations();
        this.refreshInstalledPackages();
        if (this.allPackages.length === 0) this.fetchPackages();
        else this.safePostMessage({ type: "packages", packages: this.allPackages, installed: this.installedPackages.map(p => p.source) });
        break;
      case "switchTab":
        this.activeTab = msg.tab;
        break;
      case "newConversation":
        this.onNewConversation();
        break;
      case "openConversation":
        if (msg.id) {
          const session = this.sessionManager.get(msg.id);
          if (session) this.onOpenConversation(session);
        }
        break;
      case "deleteConversation":
        if (msg.id) {
          this.onDeleteConversation(msg.id);
          this.refreshConversations();
        }
        break;
      case "install":
        if (msg.package) this.runPiCommand(["install", msg.package]);
        break;
      case "uninstall":
        if (msg.package) this.runPiCommand(["remove", msg.package]);
        break;
      case "cancel":
        this.packagesProcess?.kill();
        break;
      case "refreshPackages":
        this.refreshInstalledPackages();
        break;
      case "searchPackages":
        this.safePostMessage({ type: "packages", packages: this.allPackages, installed: this.installedPackages.map(p => p.source), query: msg.query || "" });
        break;
      // Settings messages are forwarded to extension.ts via command
      case "getSettings":
      case "setProvider":
      case "setModel":
      case "setThinkingLevel":
      case "setApiKey":
      case "setAutoSave":
      case "setUseCtrlEnter":
      case "setEnableShortcut":
      case "openSettings":
        vscode.commands.executeCommand("pi-agent._handleSidebarMessage", msg);
        break;
      case "error":
        console.error("[PiAgent Sidebar Webview Error]", msg.message, "line:", msg.line, "col:", msg.col);
        break;
    }
  }

  private refreshInstalledPackages(): void {
    const bin = findPiBinary();
    execFile(bin, ["list"], { shell: process.platform === "win32" }, (_err, stdout) => {
      this.installedPackages = parseInstalledPackages(stdout || "");
      this.webview?.postMessage({ type: "installed", packages: this.installedPackages });
    });
  }

  private async fetchPackages(): Promise<void> {
    try {
      const res = await fetch("https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=250");
      const data = await res.json();
      this.allPackages = (data.objects || []).map((o: any) => ({
        name: o.package.name,
        description: o.package.description || "",
        version: o.package.version || "",
        author: o.package.publisher?.username || o.package.author?.name || "",
        keywords: (o.package.keywords || []).join(" "),
        npm: o.package.links?.npm || ("https://www.npmjs.com/package/" + o.package.name),
        repo: o.package.links?.repository || "",
        piLabels: [],
        image: "",
        video: "",
      }));

      await Promise.all(this.allPackages.map(async (p: any) => {
        try {
          const r = await fetch("https://registry.npmjs.org/" + encodeURIComponent(p.name) + "/latest");
          const pkg = await r.json();
          if (pkg.pi && typeof pkg.pi === "object") {
            const labels: string[] = [];
            if (pkg.pi.extensions?.length) labels.push("extensions");
            if (pkg.pi.skills?.length) labels.push("skills");
            if (pkg.pi.prompts?.length) labels.push("prompts");
            if (pkg.pi.themes?.length) labels.push("themes");
            p.piLabels = labels;
            if (pkg.pi.image) p.image = pkg.pi.image;
            if (pkg.pi.video) p.video = pkg.pi.video;
          }
        } catch { /* ignore */ }
      }));

      this.webview?.postMessage({ type: "packages", packages: this.allPackages, installed: this.installedPackages.map(p => p.source) });
    } catch {
      this.webview?.postMessage({ type: "packagesError" });
    }
  }

  private runPiCommand(args: string[]): void {
    const bin = findPiBinary();
    this.webview?.postMessage({ type: "pkgLoading", loading: true, output: "" });
    const proc = spawn(bin, args, { shell: process.platform === "win32" });
    this.packagesProcess = proc;
    const onData = (chunk: Buffer) => {
      this.webview?.postMessage({ type: "pkgOutput", text: chunk.toString() });
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("close", () => {
      this.packagesProcess = undefined;
      this.webview?.postMessage({ type: "pkgLoading", loading: false });
      this.refreshInstalledPackages();
    });
  }

  private getHtml(): string {
    const nonce = this.getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src https:;">
<style nonce="${nonce}">
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-font-family), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: var(--vscode-foreground, #ccc);
  background: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Tab bar */
.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
  flex-shrink: 0;
  padding: 0 8px;
  gap: 2px;
}
.tab {
  padding: 8px 10px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-foreground, #ccc);
  opacity: 0.5;
  cursor: pointer;
  border: none;
  background: transparent;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: opacity 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  display: flex;
  align-items: center;
  gap: 4px;
}
.tab:hover { opacity: 0.8; }
.tab.active {
  opacity: 1;
  color: var(--vscode-foreground, #ccc);
  border-bottom-color: var(--vscode-activityBarBadge-background, #0e639c);
}

/* Panels */
.tab-panel { display: none; flex-direction: column; flex: 1; overflow: hidden; }
.tab-panel.active { display: flex; }

/* ─── Conversations tab ─── */
.new-conv-btn {
  margin: 8px 12px;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: background 0.15s ease, transform 0.05s ease;
  flex-shrink: 0;
}
.new-conv-btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
.new-conv-btn:active { transform: translateY(1px); }

.conv-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}
.conv-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease;
  position: relative;
}
.conv-item:hover { background: var(--vscode-list-hoverBackground, rgba(90,90,90,0.15)); }
.conv-item:active { background: var(--vscode-list-activeSelectionBackground, rgba(90,90,90,0.25)); }
.conv-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--vscode-activityBarBadge-background, #0e639c);
  color: var(--vscode-activityBarBadge-foreground, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.conv-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.conv-title {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--vscode-foreground, #ccc);
}
.conv-meta {
  font-size: 11px;
  opacity: 0.55;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.conv-item:hover .conv-actions { display: flex; }
.conv-actions button {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--vscode-foreground, #ccc);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  opacity: 0.6;
}
.conv-actions button:hover {
  background: var(--vscode-toolbar-hoverBackground, rgba(90,90,90,0.2));
  opacity: 1;
}
.empty-state {
  padding: 32px 16px;
  text-align: center;
  opacity: 0.5;
  font-size: 12px;
}
.empty-state svg { margin-bottom: 10px; opacity: 0.4; }
.loading {
  padding: 24px;
  text-align: center;
  opacity: 0.5;
  font-size: 12px;
}
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
  border-top-color: var(--vscode-progressBar-background, #007fd4);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 10px;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ─── Packages tab ─── */
.pkg-search-bar {
  padding: 8px 12px;
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.pkg-search-wrap {
  flex: 1;
  position: relative;
}
.pkg-search-wrap svg {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0.5;
  pointer-events: none;
}
.pkg-search-wrap input {
  width: 100%;
  min-width: 0;
  padding: 6px 8px 6px 28px;
  background: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 6px;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.pkg-search-wrap input:focus {
  border-color: var(--vscode-focusBorder, #007fd4);
  box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007fd4);
}
.pkg-search-wrap input::placeholder {
  color: var(--vscode-input-placeholderForeground, rgba(204,204,204,0.5));
}
.pkg-search-btn {
  padding: 6px 12px;
  cursor: pointer;
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  transition: background 0.15s ease, transform 0.05s ease;
}
.pkg-search-btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
.pkg-search-btn:active { transform: translateY(1px); }

.installed-section {
  flex-shrink: 0;
  padding: 0 12px 8px;
  border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
}
.installed-section.hidden { display: none; }
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.section-header strong {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-foreground, #ccc);
  opacity: 0.9;
}
.installed-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
  font-size: 12px;
  border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.08));
}
.installed-item:last-child { border-bottom: none; }
.installed-item code {
  font-size: 11px;
  opacity: 0.9;
  word-break: break-all;
  font-family: var(--vscode-editor-font-family), monospace;
  color: var(--vscode-textPreformat-foreground, #d4d4d4);
  background: var(--vscode-textPreformat-background, rgba(128,128,128,0.12));
  padding: 1px 5px;
  border-radius: 3px;
}
.uninstall-btn {
  padding: 3px 10px;
  cursor: pointer;
  background: transparent;
  color: var(--vscode-errorForeground, #f44336);
  border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.25));
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  transition: background 0.15s ease, border-color 0.15s ease;
  flex-shrink: 0;
  margin-left: 8px;
}
.uninstall-btn:hover {
  background: var(--vscode-inputValidation-errorBackground, rgba(244,67,54,0.12));
  border-color: var(--vscode-errorForeground, #f44336);
}

.pkg-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}
.pkg-card {
  padding: 12px;
  margin-bottom: 8px;
  background: var(--vscode-editor-background, #252526);
  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.12));
  border-radius: 8px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
}
.pkg-card:hover {
  border-color: var(--vscode-panel-border, rgba(128,128,128,0.25));
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  transform: translateY(-1px);
}
.pkg-name {
  font-weight: 600;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.pkg-name a {
  color: var(--vscode-textLink-foreground, #3794ff);
  text-decoration: none;
  transition: opacity 0.15s ease;
}
.pkg-name a:hover { opacity: 0.8; text-decoration: underline; }
.pkg-desc {
  font-size: 12px;
  line-height: 1.45;
  opacity: 0.75;
  margin-bottom: 8px;
}
.pkg-meta {
  font-size: 11px;
  opacity: 0.55;
  margin-bottom: 8px;
}
.pkg-meta span + span::before { content: " · "; }
.pkg-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
.pi-label {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  background: var(--vscode-badge-background, rgba(128,128,128,0.25));
  color: var(--vscode-badge-foreground, #ccc);
  text-transform: capitalize;
}
.pkg-media {
  margin: 8px 0;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
}
.pkg-media img, .pkg-media video { width: 100%; display: block; }
.pkg-actions {
  display: flex;
  justify-content: flex-end;
}
.pkg-actions button {
  padding: 5px 14px;
  cursor: pointer;
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border: none;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
  transition: background 0.15s ease, transform 0.05s ease;
}
.pkg-actions button:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
.pkg-actions button:active { transform: translateY(1px); }
.pkg-actions .installed-badge {
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-testing-iconPassed, #4caf50);
  background: var(--vscode-testing-iconPassed, rgba(76,175,80,0.12));
  border: 1px solid var(--vscode-testing-iconPassed, rgba(76,175,80,0.3));
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.footer-link {
  padding: 6px 12px 10px;
  text-align: right;
  flex-shrink: 0;
}
.footer-link a {
  font-size: 11px;
  color: var(--vscode-textLink-foreground, #3794ff);
  text-decoration: none;
  opacity: 0.75;
  transition: opacity 0.15s ease;
}
.footer-link a:hover { opacity: 1; text-decoration: underline; }

/* Loading overlay for packages */
.pkg-loading-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(2px);
  z-index: 100;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
}
.pkg-loading-overlay.active { display: flex; }
.pkg-loader {
  width: 28px;
  height: 28px;
  border: 3px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
  border-top-color: var(--vscode-progressBar-background, #007fd4);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.pkg-loading-overlay strong {
  font-size: 13px;
  color: var(--vscode-foreground, #ccc);
}
.output-log {
  max-height: 220px;
  width: 90%;
  max-width: 520px;
  overflow-y: auto;
  background: var(--vscode-editor-background, #1e1e1e);
  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
  border-radius: 6px;
  padding: 10px;
  font-size: 11px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--vscode-editor-font-family), monospace;
  color: var(--vscode-terminal-foreground, #ccc);
  line-height: 1.4;
}
.cancel-btn {
  padding: 5px 16px;
  cursor: pointer;
  background: var(--vscode-inputValidation-errorBackground, #b71c1c);
  color: #fff;
  border: none;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
  transition: background 0.15s ease, transform 0.05s ease;
}
.cancel-btn:hover { background: var(--vscode-inputValidation-errorBackground, #c62828); }
.cancel-btn:active { transform: translateY(1px); }

/* ─── Settings tab ─── */
.settings-panel {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px 12px;
}
.settings-group {
  margin-bottom: 14px;
}
.settings-group-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-foreground, #ccc);
  opacity: 0.6;
  margin-bottom: 8px;
  padding: 0 2px;
}
.settings-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
.settings-row label {
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground, #ccc);
}
.settings-row .hint {
  font-size: 11px;
  opacity: 0.5;
  line-height: 1.3;
}
.settings-row input[type="text"],
.settings-row input[type="password"],
.settings-row select {
  padding: 6px 8px;
  background: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 6px;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  font-family: inherit;
}
.settings-row input:focus,
.settings-row select:focus {
  border-color: var(--vscode-focusBorder, #007fd4);
  box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007fd4);
}
.settings-row input::placeholder {
  color: var(--vscode-input-placeholderForeground, rgba(204,204,204,0.5));
}
.settings-row button {
  padding: 6px 12px;
  cursor: pointer;
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  transition: background 0.15s ease, transform 0.05s ease;
  align-self: flex-start;
}
.settings-row button:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
.settings-row button:active { transform: translateY(1px); }

/* Toggle switch */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 2px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.12s ease;
}
.toggle-row:hover { background: var(--vscode-list-hoverBackground, rgba(90,90,90,0.1)); }
.toggle-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground, #ccc);
}
.toggle-hint {
  font-size: 11px;
  opacity: 0.5;
  margin-top: 1px;
}
.toggle-switch {
  position: relative;
  width: 36px;
  height: 20px;
  background: var(--vscode-button-secondaryBackground, #555);
  border-radius: 10px;
  transition: background 0.2s ease;
  flex-shrink: 0;
}
.toggle-switch::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  top: 3px;
  left: 3px;
  transition: transform 0.2s ease;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
.toggle-switch.on {
  background: var(--vscode-button-background, #0e639c);
}
.toggle-switch.on::after {
  transform: translateX(16px);
}

.settings-divider {
  height: 1px;
  background: var(--vscode-panel-border, rgba(128,128,128,0.15));
  margin: 4px 0 12px;
}

.api-key-row {
  display: flex;
  gap: 6px;
  align-items: stretch;
}
.api-key-row input {
  flex: 1;
}
</style>
</head>
<body>

<div class="tab-bar">
  <button class="tab active" data-tab="conversations" id="tab-conversations">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    Chat
  </button>
  <button class="tab" data-tab="packages" id="tab-packages">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
    Packages
  </button>
  <button class="tab" data-tab="settings" id="tab-settings">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    Settings
  </button>
</div>

<!-- Conversations Panel -->
<div class="tab-panel active" id="panel-conversations">
  <button class="new-conv-btn" id="new-conv-btn">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    New Conversation
  </button>
  <div id="conv-list" class="conv-list">
    <div class="loading"><div class="spinner"></div>Loading...</div>
  </div>
</div>

<!-- Packages Panel -->
<div class="tab-panel" id="panel-packages">
  <div class="pkg-search-bar">
    <div class="pkg-search-wrap">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="pkg-search" type="text" placeholder="Search npm packages..." />
    </div>
    <button id="pkg-search-btn">Search</button>
  </div>
  <div id="installed-section" class="installed-section hidden">
    <div class="section-header">
      <strong>Installed</strong>
      <button id="pkg-refresh-btn" style="padding:2px 8px;cursor:pointer;background:transparent;color:var(--vscode-foreground);border:1px solid var(--vscode-widget-border,transparent);border-radius:3px;font-size:11px;opacity:0.7">Refresh</button>
    </div>
    <div id="installed-list"></div>
  </div>
  <div id="pkg-loading-overlay" class="pkg-loading-overlay">
    <div class="pkg-loader"></div>
    <strong>Working...</strong>
    <pre id="pkg-output-log" class="output-log"></pre>
    <button class="cancel-btn" id="pkg-cancel-btn">Cancel</button>
  </div>
  <div id="pkg-list" class="pkg-list">
    <div class="loading"><div class="spinner"></div>Loading packages...</div>
  </div>
  <div class="footer-link">
    <a href="https://shittycodingagent.ai/packages" target="_blank">Browse all packages &nearr;</a>
  </div>
</div>

<!-- Settings Panel -->
<div class="tab-panel" id="panel-settings">
  <div class="settings-panel" id="settings-panel">
    <div class="settings-group">
      <div class="settings-group-title">AI Provider</div>
      <div class="settings-row">
        <label>Provider</label>
        <select id="setting-provider">
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="openrouter">OpenRouter</option>
          <option value="gemini">Gemini</option>
          <option value="google">Google</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Model</label>
        <input type="text" id="setting-model" placeholder="e.g. claude-sonnet-4-20250514" />
        <div class="hint">Leave empty to use provider default</div>
      </div>
      <div class="settings-row">
        <label>Thinking Level</label>
        <select id="setting-thinking">
          <option value="off">Off</option>
          <option value="minimal">Minimal</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">Extreme</option>
        </select>
      </div>
    </div>

    <div class="settings-divider"></div>

    <div class="settings-group">
      <div class="settings-group-title">Authentication</div>
      <div class="settings-row">
        <label>API Key</label>
        <div class="api-key-row">
          <input type="password" id="setting-apikey" placeholder="Enter your API key..." />
          <button id="setting-save-key">Save</button>
        </div>
        <div class="hint" id="apikey-status">No API key set</div>
      </div>
    </div>

    <div class="settings-divider"></div>

    <div class="settings-group">
      <div class="settings-group-title">Preferences</div>
      <div class="toggle-row" id="toggle-autosave">
        <div>
          <div class="toggle-label">Auto-save files</div>
          <div class="toggle-hint">Save files automatically after applying edits</div>
        </div>
        <div class="toggle-switch" id="switch-autosave"></div>
      </div>
      <div class="toggle-row" id="toggle-ctrlenter">
        <div>
          <div class="toggle-label">Ctrl+Enter to send</div>
          <div class="toggle-hint">Use Ctrl/Cmd+Enter instead of Enter to send</div>
        </div>
        <div class="toggle-switch" id="switch-ctrlenter"></div>
      </div>
      <div class="toggle-row" id="toggle-shortcut">
        <div>
          <div class="toggle-label">New conversation shortcut</div>
          <div class="toggle-hint">Enable Ctrl/Cmd+N shortcut when focused</div>
        </div>
        <div class="toggle-switch" id="switch-shortcut"></div>
      </div>
    </div>

    <div class="settings-divider"></div>

    <div class="settings-group">
      <div class="settings-row">
        <button id="open-vscode-settings" style="width:100%;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)">Open VS Code Settings</button>
      </div>
    </div>
  </div>
</div>

<script nonce="${nonce}">
(function() {
  'use strict';

  // Global error reporting
  window.onerror = function(msg, url, line, col, err) {
    try {
      if (typeof vscode !== 'undefined') {
        vscode.postMessage({ type: 'error', message: String(msg), line: line, col: col });
      }
    } catch(e) {}
    return false;
  };

  try {
    const vscode = acquireVsCodeApi();

    /* ─── Tabs ─── */
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.tab-panel');
    let activeTab = 'conversations';

    function switchTab(name) {
      activeTab = name;
      if (tabs && tabs.length) {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
      }
      if (panels && panels.length) {
        panels.forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
      }
      try { vscode.postMessage({ type: 'switchTab', tab: name }); } catch(e) {}
      if (name === 'settings') {
        try { vscode.postMessage({ type: 'getSettings' }); } catch(e) {}
      }
    }

    if (tabs && tabs.length) {
      tabs.forEach(t => {
        if (t && t.addEventListener) {
          t.addEventListener('click', () => switchTab(t.dataset.tab));
        }
      });
    }

    /* ─── Conversations ─── */
    const convList = document.getElementById('conv-list');
    const newConvBtn = document.getElementById('new-conv-btn');

    function formatDate(ts) {
      try {
        const d = new Date(ts);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      } catch(e) {
        return '';
      }
    }

    function renderConversations(sessions) {
      if (!convList) return;
      if (!sessions || !sessions.length) {
        convList.innerHTML = '<div class="empty-state"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><div>No conversations yet</div></div>';
        return;
      }
      try {
        convList.innerHTML = sessions.map(s => {
          const id = s && s.id ? String(s.id).replace(/"/g, '&quot;') : '';
          const title = s && s.title ? String(s.title).replace(/"/g, '&quot;') : '';
          const updatedAt = s && s.updatedAt ? formatDate(s.updatedAt) : '';
          return '<div class="conv-item" data-id="' + id + '">' +
            '<div class="conv-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>' +
            '<div class="conv-info"><div class="conv-title">' + esc(title) + '</div><div class="conv-meta">' + esc(updatedAt) + '</div></div>' +
            '<div class="conv-actions"><button class="delete-btn" data-id="' + id + '" title="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div>' +
          '</div>';
        }).join('');

        convList.querySelectorAll('.conv-item').forEach(el => {
          el.addEventListener('click', (e) => {
            if (e.target.closest('.delete-btn')) return;
            const id = el.dataset.id;
            if (id) try { vscode.postMessage({ type: 'openConversation', id }); } catch(e) {}
          });
        });
        convList.querySelectorAll('.delete-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (id && confirm('Delete this conversation?')) {
              try { vscode.postMessage({ type: 'deleteConversation', id }); } catch(e) {}
            }
          });
        });
      } catch(e) {
        convList.innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;opacity:0.5;font-size:12px">Error loading conversations</div>';
      }
    }

    if (newConvBtn && newConvBtn.addEventListener) {
      newConvBtn.addEventListener('click', () => {
        try { vscode.postMessage({ type: 'newConversation' }); } catch(e) {}
      });
    }

    /* ─── Packages ─── */
    const pkgSearchInput = document.getElementById('pkg-search');
    const pkgSearchBtn = document.getElementById('pkg-search-btn');
    const pkgRefreshBtn = document.getElementById('pkg-refresh-btn');
    const pkgCancelBtn = document.getElementById('pkg-cancel-btn');
    const pkgList = document.getElementById('pkg-list');
    let allPackages = [];
    let installedSet = new Set();

    function renderPackages(query) {
      if (!pkgList) return;
      const q = (query || '').toLowerCase();
      const filtered = q ? allPackages.filter(p =>
        p && p.name && p.name.toLowerCase().includes(q) ||
        p && p.description && p.description.toLowerCase().includes(q) ||
        p && p.keywords && p.keywords.toLowerCase().includes(q)
      ) : allPackages;

      if (!filtered.length) {
        pkgList.innerHTML = '<div class="status" style="padding:24px;text-align:center;opacity:0.5;font-size:12px">No packages found</div>';
        return;
      }

      pkgList.innerHTML = filtered.map(p => {
        const isInstalled = installedSet.has('npm:' + (p && p.name ? p.name : ''));
        const labels = (p && p.piLabels && p.piLabels.length) ? '<div class="pkg-labels">' + p.piLabels.map(l => '<span class="pi-label">' + esc(l) + '</span>').join(' ') + '</div>' : '';
        const media = p && p.video
          ? '<div class="pkg-media"><video src="' + esc(p.video) + '" controls muted playsinline preload="metadata"></video></div>'
          : p && p.image
            ? '<div class="pkg-media"><img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy" /></div>'
            : '';
        return '<div class="pkg-card">' +
          '<div class="pkg-name"><a href="' + (p && p.npm ? p.npm : '') + '" target="_blank">' + esc(p && p.name ? p.name : '') + '</a></div>' + labels +
          media +
          '<div class="pkg-desc">' + esc(p && p.description ? p.description : '') + '</div>' +
          '<div class="pkg-meta"><span>v' + esc(p && p.version ? p.version : '') + '</span>' + (p && p.author ? '<span>' + esc(p.author) + '</span>' : '') + '</div>' +
          '<div class="pkg-actions">' +
            (isInstalled
              ? '<span class="installed-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Installed</span>'
              : '<button onclick="installPkg(&quot;npm:' + esc(p && p.name ? p.name : '') + '&quot;)">Install</button>') +
          '</div>' +
        '</div>';
      }).join('');
    }

    function esc(s) {
      try {
        const d = document.createElement('div');
        d.textContent = typeof s === 'string' ? s : String(s);
        return d.innerHTML;
      } catch(e) {
        return '';
      }
    }

    function installPkg(pkg) { try { vscode.postMessage({ type: 'install', package: pkg }); } catch(e) {} }
    function uninstallPkg(pkg) { try { vscode.postMessage({ type: 'uninstall', package: pkg }); } catch(e) {} }

    if (pkgSearchBtn && pkgSearchBtn.addEventListener) {
      pkgSearchBtn.addEventListener('click', () => {
        renderPackages(pkgSearchInput ? pkgSearchInput.value.trim() : '');
        try { vscode.postMessage({ type: 'searchPackages', query: pkgSearchInput ? pkgSearchInput.value.trim() : '' }); } catch(e) {}
      });
    }
    if (pkgRefreshBtn && pkgRefreshBtn.addEventListener) {
      pkgRefreshBtn.addEventListener('click', () => {
        try { vscode.postMessage({ type: 'refreshPackages' }); } catch(e) {}
      });
    }
    if (pkgCancelBtn && pkgCancelBtn.addEventListener) {
      pkgCancelBtn.addEventListener('click', () => {
        try { vscode.postMessage({ type: 'cancel' }); } catch(e) {}
      });
    }
    if (pkgSearchInput && pkgSearchInput.addEventListener) {
      pkgSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          renderPackages(pkgSearchInput.value.trim());
          try { vscode.postMessage({ type: 'searchPackages', query: pkgSearchInput.value.trim() }); } catch(e) {}
        }
      });
    }

    /* ─── Settings ─── */
    const settingProvider = document.getElementById('setting-provider');
    const settingModel = document.getElementById('setting-model');
    const settingThinking = document.getElementById('setting-thinking');
    const settingApiKey = document.getElementById('setting-apikey');
    const settingSaveKey = document.getElementById('setting-save-key');
    const apiKeyStatus = document.getElementById('apikey-status');
    const switchAutoSave = document.getElementById('switch-autosave');
    const switchCtrlEnter = document.getElementById('switch-ctrlenter');
    const switchShortcut = document.getElementById('switch-shortcut');

    function updateToggle(el, on) { if (el && el.classList) el.classList.toggle('on', on); }

    if (settingProvider && settingProvider.addEventListener) {
      settingProvider.addEventListener('change', () => {
        try { vscode.postMessage({ type: 'setProvider', provider: settingProvider.value }); } catch(e) {}
      });
    }
    if (settingModel && settingModel.addEventListener) {
      settingModel.addEventListener('change', () => {
        try { vscode.postMessage({ type: 'setModel', modelId: settingModel.value }); } catch(e) {}
      });
    }
    if (settingThinking && settingThinking.addEventListener) {
      settingThinking.addEventListener('change', () => {
        try { vscode.postMessage({ type: 'setThinkingLevel', level: settingThinking.value }); } catch(e) {}
      });
    }
    if (settingSaveKey && settingSaveKey.addEventListener) {
      settingSaveKey.addEventListener('click', () => {
        try { vscode.postMessage({ type: 'setApiKey', apiKey: settingApiKey ? settingApiKey.value : '' }); } catch(e) {}
        if (settingApiKey) settingApiKey.value = '';
      });
    }

    const toggleAutoSave = document.getElementById('toggle-autosave');
    const toggleCtrlEnter = document.getElementById('toggle-ctrlenter');
    const toggleShortcut = document.getElementById('toggle-shortcut');
    const openVscodeSettings = document.getElementById('open-vscode-settings');

    if (toggleAutoSave && toggleAutoSave.addEventListener) {
      toggleAutoSave.addEventListener('click', () => {
        const on = switchAutoSave ? !switchAutoSave.classList.contains('on') : false;
        updateToggle(switchAutoSave, on);
        try { vscode.postMessage({ type: 'setAutoSave', value: on }); } catch(e) {}
      });
    }
    if (toggleCtrlEnter && toggleCtrlEnter.addEventListener) {
      toggleCtrlEnter.addEventListener('click', () => {
        const on = switchCtrlEnter ? !switchCtrlEnter.classList.contains('on') : false;
        updateToggle(switchCtrlEnter, on);
        try { vscode.postMessage({ type: 'setUseCtrlEnter', value: on }); } catch(e) {}
      });
    }
    if (toggleShortcut && toggleShortcut.addEventListener) {
      toggleShortcut.addEventListener('click', () => {
        const on = switchShortcut ? !switchShortcut.classList.contains('on') : false;
        updateToggle(switchShortcut, on);
        try { vscode.postMessage({ type: 'setEnableShortcut', value: on }); } catch(e) {}
      });
    }
    if (openVscodeSettings && openVscodeSettings.addEventListener) {
      openVscodeSettings.addEventListener('click', () => {
        try { vscode.postMessage({ type: 'openSettings' }); } catch(e) {}
      });
    }

    function applySettingsState(state) {
      try {
        if (state.provider && settingProvider) settingProvider.value = state.provider;
        if (state.model !== undefined && settingModel) settingModel.value = state.model;
        if (state.thinkingLevel && settingThinking) settingThinking.value = state.thinkingLevel;
        if (state.hasApiKey !== undefined && apiKeyStatus) {
          apiKeyStatus.textContent = state.hasApiKey ? 'API key is set' : 'No API key set';
          apiKeyStatus.style.color = state.hasApiKey ? 'var(--vscode-testing-iconPassed, #4caf50)' : '';
        }
        if (state.autoSave !== undefined) updateToggle(switchAutoSave, state.autoSave);
        if (state.useCtrlEnter !== undefined) updateToggle(switchCtrlEnter, state.useCtrlEnter);
        if (state.enableShortcut !== undefined) updateToggle(switchShortcut, state.enableShortcut);
      } catch(e) {}
    }

    /* ─── Message handling ─── */
    window.addEventListener('message', (e) => {
      try {
        const msg = e.data;
        if (!msg || !msg.type) return;

        if (msg.type === 'conversations') {
          renderConversations(msg.sessions);
          return;
        }
        if (msg.type === 'packages') {
          allPackages = msg.packages || [];
          installedSet = new Set(msg.installed || []);
          renderPackages(msg.query || (pkgSearchInput ? pkgSearchInput.value.trim() : ''));
          return;
        }
        if (msg.type === 'packagesError') {
          if (pkgList) pkgList.innerHTML = '<div class="status" style="padding:24px;text-align:center;opacity:0.5;font-size:12px">Failed to load packages</div>';
          return;
        }
        if (msg.type === 'installed') {
          const section = document.getElementById('installed-section');
          const container = document.getElementById('installed-list');
          if (!msg.packages || !msg.packages.length) {
            installedSet = new Set();
            renderPackages(pkgSearchInput ? pkgSearchInput.value.trim() : '');
            if (section) section.classList.add('hidden');
            return;
          }
          installedSet = new Set(msg.packages.map(p => p && p.source ? p.source : ''));
          renderPackages(pkgSearchInput ? pkgSearchInput.value.trim() : '');
          if (section) section.classList.remove('hidden');
          if (container) {
            container.innerHTML = msg.packages.map(p =>
              '<div class="installed-item">' +
                '<code>' + esc(p && p.source ? p.source : '') + '</code>' +
                '<button class="uninstall-btn" onclick="uninstallPkg(&quot;' + esc(p && p.source ? p.source : '') + '&quot;)">Uninstall</button>' +
              '</div>'
            ).join('');
          }
          return;
        }
        if (msg.type === 'pkgLoading') {
          const overlay = document.getElementById('pkg-loading-overlay');
          if (msg.loading) {
            const log = document.getElementById('pkg-output-log');
            if (log) log.textContent = '';
          }
          if (overlay) overlay.classList.toggle('active', msg.loading);
          return;
        }
        if (msg.type === 'pkgOutput') {
          const log = document.getElementById('pkg-output-log');
          if (log) {
            log.textContent += msg.text || '';
            log.scrollTop = log.scrollHeight;
          }
          return;
        }
        if (msg.type === 'settingsState') {
          applySettingsState(msg);
          return;
        }
        if (msg.type === 'switchToTab') {
          switchTab(msg.tab);
          return;
        }
      } catch(e) {}
    });

    // Timeout fallback: clear loading state if no data arrives
    setTimeout(function() {
      if (convList && convList.querySelector('.loading')) {
        renderConversations([]);
      }
      if (pkgList && pkgList.querySelector('.loading')) {
        renderPackages('');
      }
    }, 5000);

    // Send ready after a short delay to ensure everything is set up
    setTimeout(function() {
      try { vscode.postMessage({ type: 'ready' }); } catch(e) {}
    }, 100);

  } catch(err) {
    // If anything crashes during init, at least try to show something
    try {
      const convList = document.getElementById('conv-list');
      if (convList) convList.innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;opacity:0.5;font-size:12px">Sidebar error. Please reload window.</div>';
    } catch(e) {}
  }
})();
</script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}

function parseInstalledPackages(output: string): { source: string; path: string }[] {
  const packages: { source: string; path: string }[] = [];
  const lines = output.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("npm:") || trimmed.startsWith("github:") || trimmed.startsWith("http")) {
      const pathLine = lines[i + 1]?.trim() || "";
      packages.push({ source: trimmed, path: pathLine });
    }
  }
  return packages;
}
