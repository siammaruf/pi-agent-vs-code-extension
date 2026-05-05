import * as vscode from 'vscode';
import { PiWebviewProvider } from './webviewProvider.js';
import { PiSessionManager } from './piSessionManager.js';
import { DiffManager } from './diffManager.js';
import { ConfigurationManager } from './configurationManager.js';
import { SessionManager } from './sessionManager.js';
import { ContextProvider } from './contextProvider.js';
import { SidebarProvider } from './sidebarProvider.js';
import { CommandId, ViewId, PANEL_VIEW_TYPE, ContextKey } from './types.js';
import type { WebviewToHostMessage, ConversationSession } from './types.js';

let extensionContext: vscode.ExtensionContext;
let webviewProvider: PiWebviewProvider;
let sidebarProvider: SidebarProvider;
let piSessionManager: PiSessionManager;
let diffManager: DiffManager;
let configManager: ConfigurationManager;
let sessionManager: SessionManager;
let contextProvider: ContextProvider;
let currentConversationId: string | undefined;
let isActivated = false;

export function activate(context: vscode.ExtensionContext): void {
  if (isActivated) return;
  isActivated = true;
  extensionContext = context;

  // Initialize managers
  configManager = new ConfigurationManager();
  sessionManager = new SessionManager(context);
  diffManager = new DiffManager(context);
  contextProvider = new ContextProvider();
  webviewProvider = new PiWebviewProvider(context.extensionUri);
  piSessionManager = new PiSessionManager(
    webviewProvider,
    diffManager,
    configManager,
    contextProvider,
    context
  );
  sidebarProvider = new SidebarProvider(
    context.extensionUri,
    sessionManager,
    () => startNewConversation(),
    (session) => openConversation(session),
    (id) => {
      sessionManager.delete(id);
      if (currentConversationId === id) {
        currentConversationId = undefined;
      }
    }
  );

  // Register sidebar view provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ViewId.Sidebar, sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Register commands
  registerCommand(CommandId.Open, openInPanel);
  registerCommand(CommandId.OpenSidebar, openSidebar);
  registerCommand(CommandId.NewConversation, newConversationCommand);
  registerCommand(CommandId.FocusInput, focusInput);
  registerCommand(CommandId.InsertAtMention, insertAtMention);
  registerCommand(CommandId.AcceptDiff, () => {
    const id = diffManager.getCurrentDiffId();
    if (id) diffManager.resolveDecision(id, true);
  });
  registerCommand(CommandId.RejectDiff, () => {
    const id = diffManager.getCurrentDiffId();
    if (id) diffManager.resolveDecision(id, false);
  });
  registerCommand(CommandId.SetApiKey, setApiKey);
  registerCommand(CommandId.ShowSettings, showSettings);

  // Internal message routing commands
  registerCommand('pi-agent._handleWebviewMessage', (...args: unknown[]) => handleWebviewMessage(args[0] as any));
  registerCommand('pi-agent._handleSidebarMessage', (...args: unknown[]) => handleSidebarMessage(args[0] as any));

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
      if (e.affectsConfiguration('piAgent')) {
        configManager.reload();
      }
    })
  );

  // Initialize session on startup (create a default conversation if none exist)
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  void piSessionManager.createSession(cwd);
}

export function deactivate(): void {
  isActivated = false;
  piSessionManager?.dispose();
  webviewProvider?.dispose();
  sidebarProvider?.dispose();
}

function registerCommand(command: string, callback: (...args: unknown[]) => unknown): void {
  extensionContext.subscriptions.push(vscode.commands.registerCommand(command, callback));
}

// ─── Conversation Management ───

function startNewConversation(): void {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const session = sessionManager.create(cwd, 'New Conversation');
  currentConversationId = session.id;
  piSessionManager.newConversation();
  webviewProvider.postMessage({ type: 'newConversation' });
  sidebarProvider.refreshConversations();
  openInPanel();
}

function openConversation(session: ConversationSession): void {
  currentConversationId = session.id;
  piSessionManager.newConversation();
  webviewProvider.postMessage({ type: 'newConversation' });
  openInPanel();
}

// ─── Command Implementations ───

async function openInPanel(): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    PANEL_VIEW_TYPE,
    'Pi Agent',
    vscode.ViewColumn.One,
    webviewProvider.getWebviewOptions()
  );
  panel.iconPath = {
    light: vscode.Uri.joinPath(extensionContext.extensionUri, 'resources', 'pi-logo-light.svg'),
    dark: vscode.Uri.joinPath(extensionContext.extensionUri, 'resources', 'pi-logo-dark.svg'),
  };
  webviewProvider.resolveWebview(panel.webview, panel);
}

async function openSidebar(): Promise<void> {
  await vscode.commands.executeCommand(`${ViewId.Sidebar}.focus`);
}

async function newConversationCommand(): Promise<void> {
  startNewConversation();
}

async function focusInput(): Promise<void> {
  webviewProvider.postMessage({ type: 'focusInput' });
}

async function insertAtMention(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  webviewProvider.postMessage({ type: 'insertAtMention', uri: editor.document.uri.toString() });
}

async function setApiKey(): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    prompt: 'Enter your API key for Pi Agent',
    password: true,
    ignoreFocusOut: true,
  });
  if (apiKey) {
    await configManager.setApiKey(extensionContext, apiKey);
    vscode.window.showInformationMessage('API key saved securely.');
  }
}

async function showSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:pi-agent piAgent');
}

// ─── Webview Message Handler ───

async function handleWebviewMessage(message: WebviewToHostMessage): Promise<void> {
  switch (message.type) {
    case 'webviewReady':
      webviewProvider.flushQueue();
      break;
    case 'sendMessage':
      // Update conversation title on first message
      if (currentConversationId) {
        const session = sessionManager.get(currentConversationId);
        if (session && session.title === 'New Conversation') {
          const title = message.text.slice(0, 40) + (message.text.length > 40 ? '...' : '');
          sessionManager.update(currentConversationId, { title });
          sidebarProvider.refreshConversations();
        }
        sessionManager.update(currentConversationId, { updatedAt: Date.now() });
      }
      await piSessionManager.sendPrompt(message.text);
      break;
    case 'steerMessage':
      await piSessionManager.steer(message.text);
      break;
    case 'abort':
      await piSessionManager.abort();
      break;
    case 'newConversation':
      piSessionManager.newConversation();
      break;
    case 'applyEdit':
      diffManager.resolveDecision(message.diffId, true);
      break;
    case 'rejectEdit':
      diffManager.resolveDecision(message.diffId, false);
      break;
    case 'openFile': {
      const uri = vscode.Uri.parse(message.uri);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      if (message.range) {
        const [startLine, startChar, endLine, endChar] = message.range;
        const selection = new vscode.Range(startLine, startChar, endLine, endChar);
        editor.selection = new vscode.Selection(selection.start, selection.end);
        editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
      }
      break;
    }
    case 'readFile': {
      const uri = vscode.Uri.parse(message.uri);
      try {
        const content = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(content).toString('utf-8');
        webviewProvider.postMessage({ type: 'fileContent', uri: message.uri, content: text });
      } catch (err) {
        webviewProvider.postMessage({ type: 'fileError', uri: message.uri, error: String(err) });
      }
      break;
    }
    case 'listFiles': {
      const uri = vscode.Uri.file(message.directory);
      try {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        webviewProvider.postMessage({
          type: 'fileList',
          directory: message.directory,
          entries: entries.map(([name, type]) => ({ name, type })),
        });
      } catch (err) {
        webviewProvider.postMessage({ type: 'fileError', directory: message.directory, error: String(err) });
      }
      break;
    }
    case 'getCurrentSelection': {
      const selection = contextProvider.getCurrentSelection();
      if (selection) {
        webviewProvider.postMessage({
          type: 'selection',
          text: selection.text,
          file: selection.file,
          range: selection.range,
        });
      }
      break;
    }
    case 'getProviderState': {
      const availableModels = await piSessionManager.getAvailableModels();
      webviewProvider.postMessage({
        type: 'providerState',
        provider: configManager.provider,
        model: configManager.model,
        availableModels,
        thinkingLevel: configManager.thinkingLevel,
      });
      break;
    }
    case 'getAuthStatus': {
      const apiKey = await configManager.getApiKey(extensionContext);
      webviewProvider.postMessage({
        type: 'authStatus',
        hasApiKey: !!apiKey,
        provider: configManager.provider,
      });
      break;
    }
    case 'setApiKey': {
      if (message.apiKey) {
        await configManager.setApiKey(extensionContext, message.apiKey);
        vscode.window.showInformationMessage('API key saved securely.');
        webviewProvider.postMessage({
          type: 'authStatus',
          hasApiKey: true,
          provider: configManager.provider,
        });
        // Recreate session with new key
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        await piSessionManager.createSession(cwd);
      }
      break;
    }
    case 'setModel': {
      await vscode.workspace.getConfiguration('piAgent').update('model', message.modelId, true);
      configManager.reload();
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
      await piSessionManager.createSession(cwd);
      webviewProvider.postMessage({
        type: 'providerState',
        provider: configManager.provider,
        model: configManager.model,
        availableModels: await piSessionManager.getAvailableModels(),
        thinkingLevel: configManager.thinkingLevel,
      });
      break;
    }
    case 'setProvider': {
      await vscode.workspace.getConfiguration('piAgent').update('provider', message.provider, true);
      configManager.reload();
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
      await piSessionManager.createSession(cwd);
      webviewProvider.postMessage({
        type: 'providerState',
        provider: configManager.provider,
        model: configManager.model,
        availableModels: await piSessionManager.getAvailableModels(),
        thinkingLevel: configManager.thinkingLevel,
      });
      break;
    }
    case 'setThinkingLevel': {
      await vscode.workspace.getConfiguration('piAgent').update('thinkingLevel', message.level, true);
      configManager.reload();
      webviewProvider.postMessage({
        type: 'providerState',
        provider: configManager.provider,
        model: configManager.model,
        availableModels: await piSessionManager.getAvailableModels(),
        thinkingLevel: configManager.thinkingLevel,
      });
      break;
    }
    case 'showNotification': {
      if (message.message) {
        vscode.window.showInformationMessage(message.message);
      }
      break;
    }
    default:
      console.warn('[PiAgent] Unknown webview message:', (message as any).type);
  }
}

// ─── Sidebar Message Handler ───

async function handleSidebarMessage(message: any): Promise<void> {
  switch (message.type) {
    case 'getSettings': {
      const apiKey = await configManager.getApiKey(extensionContext);
      sidebarProvider.updateSettingsState({
        provider: configManager.provider,
        model: configManager.model,
        thinkingLevel: configManager.thinkingLevel,
        hasApiKey: !!apiKey,
        autoSave: configManager.autoSave,
        useCtrlEnter: configManager.useCtrlEnterToSend,
        enableShortcut: configManager.enableNewConversationShortcut,
      });
      break;
    }
    case 'setProvider': {
      if (message.provider) {
        await vscode.workspace.getConfiguration('piAgent').update('provider', message.provider, true);
        configManager.reload();
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        await piSessionManager.createSession(cwd);
        sidebarProvider.updateSettingsState({ provider: configManager.provider });
      }
      break;
    }
    case 'setModel': {
      if (message.modelId !== undefined) {
        await vscode.workspace.getConfiguration('piAgent').update('model', message.modelId, true);
        configManager.reload();
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        await piSessionManager.createSession(cwd);
        sidebarProvider.updateSettingsState({ model: configManager.model });
      }
      break;
    }
    case 'setThinkingLevel': {
      if (message.level) {
        await vscode.workspace.getConfiguration('piAgent').update('thinkingLevel', message.level, true);
        configManager.reload();
        sidebarProvider.updateSettingsState({ thinkingLevel: configManager.thinkingLevel });
      }
      break;
    }
    case 'setApiKey': {
      if (message.apiKey) {
        await configManager.setApiKey(extensionContext, message.apiKey);
        vscode.window.showInformationMessage('API key saved securely.');
        sidebarProvider.updateSettingsState({ hasApiKey: true });
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        await piSessionManager.createSession(cwd);
      }
      break;
    }
    case 'setAutoSave': {
      await vscode.workspace.getConfiguration('piAgent').update('autoSave', message.value, true);
      configManager.reload();
      sidebarProvider.updateSettingsState({ autoSave: configManager.autoSave });
      break;
    }
    case 'setUseCtrlEnter': {
      await vscode.workspace.getConfiguration('piAgent').update('useCtrlEnterToSend', message.value, true);
      configManager.reload();
      sidebarProvider.updateSettingsState({ useCtrlEnter: configManager.useCtrlEnterToSend });
      break;
    }
    case 'setEnableShortcut': {
      await vscode.workspace.getConfiguration('piAgent').update('enableNewConversationShortcut', message.value, true);
      configManager.reload();
      sidebarProvider.updateSettingsState({ enableShortcut: configManager.enableNewConversationShortcut });
      break;
    }
    case 'openSettings': {
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:pi-agent piAgent');
      break;
    }
    default:
      console.warn('[PiAgent] Unknown sidebar message:', message.type);
  }
}
