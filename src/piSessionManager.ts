import {
  createAgentSession,
  SessionManager as PiSdkSessionManager,
  AuthStorage,
  ModelRegistry,
  SettingsManager,
  DefaultResourceLoader,
} from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import type { AgentSession, AgentSessionEvent } from '@mariozechner/pi-coding-agent';
import * as vscode from 'vscode';
import * as path from 'path';
import type { PiWebviewProvider } from './webviewProvider.js';
import type { DiffManager } from './diffManager.js';
import type { ConfigurationManager } from './configurationManager.js';
import type { ContextProvider } from './contextProvider.js';
import { createCustomTools } from './toolProxy.js';

const FRIENDLY_API_KEY_ERROR = 'Your API key is missing. Add it in Pi Agent settings to start chatting.';

function isApiKeyError(message: string): boolean {
  return message.includes('No API key found');
}

function toFriendlyError(message: string): string {
  if (isApiKeyError(message)) {
    return FRIENDLY_API_KEY_ERROR;
  }
  return message;
}

export class PiSessionManager {
  private session?: AgentSession;
  private unsubscribe?: () => void;
  private modelRegistry?: ModelRegistry;

  constructor(
    private readonly webviewProvider: PiWebviewProvider,
    private readonly diffManager: DiffManager,
    private readonly configManager: ConfigurationManager,
    private readonly contextProvider: ContextProvider,
    private readonly context: vscode.ExtensionContext
  ) {}

  async createSession(cwd: string): Promise<void> {
    if (this.session) {
      this.dispose();
    }

    try {
      const apiKey = await this.configManager.getApiKey(this.context);
      const authStorage = AuthStorage.create();
      if (apiKey) {
        authStorage.setRuntimeApiKey(this.configManager.provider, apiKey);
      }

      this.modelRegistry = ModelRegistry.create(authStorage);
      let model: any = getModel(this.configManager.provider as any, this.configManager.model as any);
      if (!model) {
        const available = await this.modelRegistry.getAvailable();
        if (available.length > 0) {
          model = available[0];
        }
      }

      const settingsManager = SettingsManager.inMemory();
      const agentDir = path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), '.pi', 'agent');
      const resourceLoader = new DefaultResourceLoader({ cwd, agentDir });
      await resourceLoader.reload();

      const customTools = createCustomTools(cwd, this.diffManager);

      const { session } = await createAgentSession({
        cwd,
        model: model as any,
        thinkingLevel: this.configManager.thinkingLevel as any,
        authStorage,
        modelRegistry: this.modelRegistry,
        settingsManager,
        resourceLoader,
        customTools,
        noTools: 'builtin',
        tools: ['read', 'edit', 'write', 'bash', 'grep', 'find', 'ls'],
        sessionManager: PiSdkSessionManager.inMemory(),
      });

      this.session = session;
      this.unsubscribe = session.subscribe((event) => {
        this.handlePiEvent(event);
      });

      this.webviewProvider.postMessage({
        type: 'sessionState',
        messages: [],
        isStreaming: false,
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = toFriendlyError(rawMessage);
      if (isApiKeyError(rawMessage)) {
        const choice = await vscode.window.showErrorMessage(
          message,
          'Open Settings',
          'Dismiss'
        );
        if (choice === 'Open Settings') {
          await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:pi-agent piAgent');
        }
      } else {
        vscode.window.showErrorMessage(`Failed to start Pi Agent session: ${message}`);
      }
      this.webviewProvider.postMessage({
        type: 'piEvent',
        event: { type: 'error', message },
      });
    }
  }

  async getAvailableModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    try {
      if (!this.modelRegistry) {
        const apiKey = await this.configManager.getApiKey(this.context);
        const authStorage = AuthStorage.create();
        if (apiKey) {
          authStorage.setRuntimeApiKey(this.configManager.provider, apiKey);
        }
        this.modelRegistry = ModelRegistry.create(authStorage);
      }
      const models = await this.modelRegistry.getAvailable();
      return models.map((m: any) => ({
        id: m.id || m.modelId || String(m),
        name: m.name || m.id || m.modelId || String(m),
        provider: m.provider || this.configManager.provider,
      }));
    } catch {
      return [];
    }
  }

  async sendPrompt(text: string): Promise<void> {
    if (!this.session) {
      vscode.window.showWarningMessage('Pi Agent session not started');
      return;
    }

    const contextText = this.contextProvider.formatContext();
    const fullPrompt = contextText ? `${contextText}\n\n${text}` : text;

    try {
      await this.session.prompt(fullPrompt);
    } catch (error) {
      const message = toFriendlyError(error instanceof Error ? error.message : String(error));
      this.webviewProvider.postMessage({
        type: 'piEvent',
        event: { type: 'error', message },
      });
    }
  }

  async steer(text: string): Promise<void> {
    if (!this.session) return;
    try {
      await this.session.steer(text);
    } catch (error) {
      const message = toFriendlyError(error instanceof Error ? error.message : String(error));
      this.webviewProvider.postMessage({
        type: 'piEvent',
        event: { type: 'error', message },
      });
    }
  }

  async abort(): Promise<void> {
    if (!this.session) return;
    await this.session.abort();
  }

  newConversation(): void {
    this.dispose();
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    void this.createSession(cwd);
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    if (this.session) {
      this.session.dispose();
      this.session = undefined;
    }
  }

  getSession(): AgentSession | undefined {
    return this.session;
  }

  private handlePiEvent(event: AgentSessionEvent): void {
    // Forward relevant events to webview
    this.webviewProvider.postMessage({
      type: 'piEvent',
      event: event as unknown,
    });

    // Also send periodic state sync
    if (event.type === 'agent_end' || event.type === 'message_end') {
      this.syncSessionState();
    }
  }

  private syncSessionState(): void {
    if (!this.session) return;
    this.webviewProvider.postMessage({
      type: 'sessionState',
      messages: this.session.messages as unknown[],
      isStreaming: this.session.isStreaming,
      model: this.session.model as unknown,
    });
  }
}
