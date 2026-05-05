import * as vscode from 'vscode';

const CONFIG_SECTION = 'piAgent';
const SECRET_API_KEY = 'piAgent.apiKey';

export class ConfigurationManager {
  private config: vscode.WorkspaceConfiguration;

  constructor() {
    this.config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  }

  reload(): void {
    this.config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  }

  get provider(): string {
    return this.config.get<string>('provider', 'anthropic');
  }

  get model(): string {
    return this.config.get<string>('model', '');
  }

  get thinkingLevel(): string {
    return this.config.get<string>('thinkingLevel', 'medium');
  }

  get autoSave(): boolean {
    return this.config.get<boolean>('autoSave', true);
  }

  get useCtrlEnterToSend(): boolean {
    return this.config.get<boolean>('useCtrlEnterToSend', false);
  }

  get preferredLocation(): 'sidebar' | 'panel' {
    return this.config.get<'sidebar' | 'panel'>('preferredLocation', 'sidebar');
  }

  get enableNewConversationShortcut(): boolean {
    return this.config.get<boolean>('enableNewConversationShortcut', true);
  }

  async getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    return context.secrets.get(SECRET_API_KEY);
  }

  async setApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
    await context.secrets.store(SECRET_API_KEY, apiKey);
  }

  async deleteApiKey(context: vscode.ExtensionContext): Promise<void> {
    await context.secrets.delete(SECRET_API_KEY);
  }
}
