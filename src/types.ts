import type * as vscode from 'vscode';

// ─── Webview Message Protocol ───

export interface WebviewMessage {
  type: string;
}

export interface WebviewReadyMessage extends WebviewMessage {
  type: 'webviewReady';
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

// Host → Webview
export type HostToWebviewMessage =
  | { type: 'piEvent'; event: unknown }
  | { type: 'sessionState'; messages: unknown[]; isStreaming: boolean; model?: unknown }
  | { type: 'providerState'; provider: string; model: string; availableModels: ModelInfo[]; thinkingLevel: string }
  | { type: 'authStatus'; hasApiKey: boolean; provider: string }
  | { type: 'fileContent'; uri: string; content: string }
  | { type: 'fileList'; directory: string; entries: Array<{ name: string; type: number }> }
  | { type: 'fileError'; uri?: string; directory?: string; error: string }
  | { type: 'selection'; text: string; file: string; range: [number, number, number, number] }
  | { type: 'insertAtMention'; uri: string }
  | { type: 'focusInput' }
  | { type: 'blurInput' }
  | { type: 'newConversation' }
  | { type: 'diffResolved'; diffId: string; accepted: boolean };

// Webview → Host
export type WebviewToHostMessage =
  | { type: 'webviewReady' }
  | { type: 'sendMessage'; text: string; attachments?: string[] }
  | { type: 'steerMessage'; text: string }
  | { type: 'abort' }
  | { type: 'newConversation' }
  | { type: 'applyEdit'; diffId: string }
  | { type: 'rejectEdit'; diffId: string }
  | { type: 'openFile'; uri: string; range?: [number, number, number, number] }
  | { type: 'readFile'; uri: string }
  | { type: 'listFiles'; directory: string }
  | { type: 'getCurrentSelection' }
  | { type: 'setModel'; modelId: string }
  | { type: 'setProvider'; provider: string }
  | { type: 'setThinkingLevel'; level: string }
  | { type: 'setApiKey'; apiKey: string }
  | { type: 'getProviderState' }
  | { type: 'getAuthStatus' }
  | { type: 'insertAtMention'; uri: string }
  | { type: 'showNotification'; message: string };

// ─── Diff Types ───

export interface ProposedDiff {
  id: string;
  uri: vscode.Uri;
  originalContent: string;
  proposedContent: string;
  range?: vscode.Range;
  resolver?: (accepted: boolean) => void;
  decided?: boolean;
  accepted?: boolean;
}

// ─── Session Metadata ───

export interface ConversationSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  workspacePath: string;
}

// ─── Configuration ───

export interface PiAgentConfiguration {
  provider: string;
  model: string;
  thinkingLevel: string;
  autoSave: boolean;
  useCtrlEnterToSend: boolean;
  preferredLocation: 'sidebar' | 'panel';
  enableNewConversationShortcut: boolean;
}

// ─── Context Key ───

export const enum ContextKey {
  ViewingProposedDiff = 'pi-agent.viewingProposedDiff',
  Focused = 'pi-agent.focused',
}

// ─── Command IDs ───

export const enum CommandId {
  Open = 'pi-agent.open',
  OpenSidebar = 'pi-agent.openSidebar',
  NewConversation = 'pi-agent.newConversation',
  FocusInput = 'pi-agent.focusInput',
  InsertAtMention = 'pi-agent.insertAtMention',
  AcceptDiff = 'pi-agent.acceptDiff',
  RejectDiff = 'pi-agent.rejectDiff',
  SetApiKey = 'pi-agent.setApiKey',
  ShowSettings = 'pi-agent.showSettings',
}

// ─── View IDs ───

export const enum ViewId {
  Sidebar = 'piAgentSidebar',
}

export const PANEL_VIEW_TYPE = 'piAgentPanel';
