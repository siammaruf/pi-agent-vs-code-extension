import * as vscode from 'vscode';
import * as path from 'path';
import type { ProposedDiff } from './types.js';
import { ContextKey } from './types.js';

const ORIGINAL_SCHEME = 'pi-original';
const PROPOSED_SCHEME = 'pi-proposed';

export class DiffManager {
  private diffs: Map<string, ProposedDiff> = new Map();
  private currentDiffId?: string;
  private originalProvider: vscode.TextDocumentContentProvider;
  private proposedProvider: vscode.TextDocumentContentProvider;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.originalProvider = {
      provideTextDocumentContent: (uri: vscode.Uri) => {
        const diff = this.findDiffByUri(uri);
        return diff?.originalContent ?? '';
      },
    };

    this.proposedProvider = {
      provideTextDocumentContent: (uri: vscode.Uri) => {
        const diff = this.findDiffByUri(uri);
        return diff?.proposedContent ?? '';
      },
    };

    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(ORIGINAL_SCHEME, this.originalProvider)
    );
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, this.proposedProvider)
    );
  }

  /**
   * Register a diff and show it in the diff editor.
   * Returns a Promise that resolves when the user accepts or rejects.
   */
  async registerAndShowDiff(uri: vscode.Uri, original: string, proposed: string): Promise<string> {
    const diffId = `diff-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const diff: ProposedDiff = {
      id: diffId,
      uri,
      originalContent: original,
      proposedContent: proposed,
      resolver: undefined,
    };
    this.diffs.set(diffId, diff);
    this.currentDiffId = diffId;
    this.updateContext(true);

    const originalUri = uri.with({ scheme: ORIGINAL_SCHEME });
    const proposedUri = uri.with({ scheme: PROPOSED_SCHEME });

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      proposedUri,
      `Pi Agent: ${path.basename(uri.path)}`
    );

    return diffId;
  }

  /**
   * Wait for the user to accept or reject the diff.
   */
  waitForUserDecision(diffId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const diff = this.diffs.get(diffId);
      if (!diff) {
        resolve(false);
        return;
      }
      // If decision was already made before waitForUserDecision was called, resolve immediately
      if (diff.decided) {
        resolve(diff.accepted ?? false);
        return;
      }
      diff.resolver = (accepted: boolean) => {
        resolve(accepted);
      };
    });
  }

  /**
   * Apply the diff to the workspace.
   */
  async applyDiff(diffId: string): Promise<void> {
    const diff = this.diffs.get(diffId);
    if (!diff) return;

    const edit = new vscode.WorkspaceEdit();
    const doc = await vscode.workspace.openTextDocument(diff.uri);
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length)
    );
    edit.replace(diff.uri, fullRange, diff.proposedContent);
    await vscode.workspace.applyEdit(edit);
    await doc.save();

    this.diffs.delete(diffId);
    if (this.currentDiffId === diffId) {
      this.currentDiffId = undefined;
      this.updateContext(false);
    }
  }

  /**
   * Reject the diff and close the diff editor.
   */
  async rejectDiff(diffId: string): Promise<void> {
    const diff = this.diffs.get(diffId);
    if (!diff) return;

    this.diffs.delete(diffId);
    if (this.currentDiffId === diffId) {
      this.currentDiffId = undefined;
      this.updateContext(false);
    }

    // Close diff editors if open
    for (const tab of vscode.window.tabGroups.all.flatMap((g) => g.tabs)) {
      if (tab.input instanceof vscode.TabInputTextDiff) {
        const diffInput = tab.input as vscode.TabInputTextDiff;
        if (
          diffInput.original.scheme === ORIGINAL_SCHEME ||
          diffInput.modified.scheme === PROPOSED_SCHEME
        ) {
          await vscode.window.tabGroups.close(tab);
        }
      }
    }
  }

  getCurrentDiffId(): string | undefined {
    return this.currentDiffId;
  }

  resolveDecision(diffId: string, accepted: boolean): void {
    const diff = this.diffs.get(diffId);
    if (!diff) return;
    diff.decided = true;
    diff.accepted = accepted;
    if (diff.resolver) {
      diff.resolver(accepted);
    }
  }

  private findDiffByUri(uri: vscode.Uri): ProposedDiff | undefined {
    const filePath = uri.with({ scheme: 'file' }).toString();
    for (const diff of this.diffs.values()) {
      if (diff.uri.toString() === filePath) {
        return diff;
      }
    }
    return undefined;
  }

  private updateContext(active: boolean): void {
    vscode.commands.executeCommand('setContext', ContextKey.ViewingProposedDiff, active);
  }
}
