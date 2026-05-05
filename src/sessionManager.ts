import * as vscode from 'vscode';
import type { ConversationSession } from './types.js';

const SESSIONS_KEY = 'pi-agent.sessions';

export class SessionManager {
  private sessions: ConversationSession[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.load();
  }

  getAll(): ReadonlyArray<ConversationSession> {
    return this.sessions;
  }

  get(id: string): ConversationSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  create(workspacePath: string, title?: string): ConversationSession {
    const now = Date.now();
    const session: ConversationSession = {
      id: this.generateId(),
      title: title ?? 'New Conversation',
      createdAt: now,
      updatedAt: now,
      workspacePath,
    };
    this.sessions.push(session);
    this.save();
    return session;
  }

  update(id: string, updates: Partial<Omit<ConversationSession, 'id'>>): boolean {
    const idx = this.sessions.findIndex((s) => s.id === id);
    if (idx < 0) return false;
    this.sessions[idx] = { ...this.sessions[idx], ...updates, updatedAt: Date.now() };
    this.save();
    return true;
  }

  delete(id: string): boolean {
    const idx = this.sessions.findIndex((s) => s.id === id);
    if (idx < 0) return false;
    this.sessions.splice(idx, 1);
    this.save();
    return true;
  }

  private load(): void {
    const stored = this.context.globalState.get<ConversationSession[]>(SESSIONS_KEY, []);
    this.sessions = Array.isArray(stored) ? stored : [];
  }

  private save(): void {
    void this.context.globalState.update(SESSIONS_KEY, this.sessions);
  }

  private generateId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
