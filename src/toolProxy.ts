import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@mariozechner/pi-ai';
import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { DiffManager } from './diffManager.js';

const execAsync = promisify(exec);

export function createCustomTools(cwd: string, diffManager: DiffManager) {
  const readTool = defineTool({
    name: 'read',
    label: 'Read File',
    description: 'Read the contents of a file at the specified path. Optionally read a specific range with offset and limit.',
    parameters: Type.Object({
      path: Type.String({ description: 'Relative path to the file' }),
      offset: Type.Optional(Type.Number({ description: 'Line offset to start reading from' })),
      limit: Type.Optional(Type.Number({ description: 'Maximum number of lines to read' })),
    }),
    execute: async (_toolCallId, params) => {
      const filePath = path.resolve(cwd, params.path);
      const uri = vscode.Uri.file(filePath);
      const data = await vscode.workspace.fs.readFile(uri);
      let content = Buffer.from(data).toString('utf-8');

      if (params.offset !== undefined || params.limit !== undefined) {
        const lines = content.split('\n');
        const start = params.offset ?? 0;
        const end = params.limit !== undefined ? start + params.limit : lines.length;
        content = lines.slice(start, end).join('\n');
      }

      return {
        content: [{ type: 'text' as const, text: content }],
        details: {},
      };
    },
  });

  const editTool = defineTool({
    name: 'edit',
    label: 'Edit File',
    description: 'Propose edits to a file. Each edit replaces oldText with newText. The user must approve changes before they are applied.',
    parameters: Type.Object({
      path: Type.String({ description: 'Relative path to the file' }),
      edits: Type.Array(
        Type.Object({
          oldText: Type.String({ description: 'Text to replace' }),
          newText: Type.String({ description: 'Replacement text' }),
        }),
        { description: 'List of edits to apply' }
      ),
    }),
    execute: async (_toolCallId, params) => {
      const filePath = path.resolve(cwd, params.path);
      const uri = vscode.Uri.file(filePath);

      let original: string;
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        original = Buffer.from(data).toString('utf-8');
      } catch {
        throw new Error(`File not found: ${params.path}`);
      }

      let proposed = original;
      for (const edit of params.edits) {
        if (!proposed.includes(edit.oldText)) {
          throw new Error(`Could not find text to replace in ${params.path}: "${edit.oldText.slice(0, 50)}..."`);
        }
        proposed = proposed.replace(edit.oldText, edit.newText);
      }

      const diffId = await diffManager.registerAndShowDiff(uri, original, proposed);
      const accepted = await diffManager.waitForUserDecision(diffId);

      if (accepted) {
        await diffManager.applyDiff(diffId);
        return {
          content: [{ type: 'text' as const, text: `Edited ${params.path}` }],
          details: {},
        };
      } else {
        await diffManager.rejectDiff(diffId);
        throw new Error(`User rejected edits to ${params.path}`);
      }
    },
  });

  const writeTool = defineTool({
    name: 'write',
    label: 'Write File',
    description: 'Create or overwrite a file with new content. The user must approve before the file is written.',
    parameters: Type.Object({
      path: Type.String({ description: 'Relative path to the file' }),
      content: Type.String({ description: 'File content to write' }),
    }),
    execute: async (_toolCallId, params) => {
      const filePath = path.resolve(cwd, params.path);
      const uri = vscode.Uri.file(filePath);

      let original = '';
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        original = Buffer.from(data).toString('utf-8');
      } catch {
        // File doesn't exist, original stays empty
      }

      const diffId = await diffManager.registerAndShowDiff(uri, original, params.content);
      const accepted = await diffManager.waitForUserDecision(diffId);

      if (accepted) {
        await diffManager.applyDiff(diffId);
        return {
          content: [{ type: 'text' as const, text: `Wrote ${params.path}` }],
          details: {},
        };
      } else {
        await diffManager.rejectDiff(diffId);
        throw new Error(`User rejected writing ${params.path}`);
      }
    },
  });

  const bashTool = defineTool({
    name: 'bash',
    label: 'Bash',
    description: 'Execute a bash command in the workspace directory and return the output.',
    parameters: Type.Object({
      command: Type.String({ description: 'Command to execute' }),
      timeout: Type.Optional(Type.Number({ description: 'Timeout in milliseconds' })),
    }),
    execute: async (_toolCallId, params) => {
      const { stdout, stderr } = await execAsync(params.command, {
        cwd,
        timeout: params.timeout ?? 30000,
        maxBuffer: 1024 * 1024,
      });

      const output = stdout + (stderr ? `\nstderr:\n${stderr}` : '');
      return {
        content: [{ type: 'text' as const, text: output || '(no output)' }],
        details: {},
      };
    },
  });

  const grepTool = defineTool({
    name: 'grep',
    label: 'Grep',
    description: 'Search for a pattern in workspace files. Returns matching lines with file paths.',
    parameters: Type.Object({
      pattern: Type.String({ description: 'Search pattern' }),
      path: Type.Optional(Type.String({ description: 'Directory or file to search in' })),
      glob: Type.Optional(Type.String({ description: 'Glob pattern to filter files' })),
      ignoreCase: Type.Optional(Type.Boolean({ description: 'Case-insensitive search' })),
      limit: Type.Optional(Type.Number({ description: 'Maximum number of matches' })),
    }),
    execute: async (_toolCallId, params) => {
      const searchPath = params.path ? path.resolve(cwd, params.path) : cwd;
      const pattern = params.glob ?? '**/*';
      const uri = vscode.Uri.file(searchPath);

      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(uri, pattern),
        '**/node_modules/**',
        500
      );

      const regex = new RegExp(params.pattern, params.ignoreCase ? 'gi' : 'g');
      const limit = params.limit ?? 50;
      const matches: string[] = [];

      for (const file of files) {
        if (matches.length >= limit) break;
        try {
          const data = await vscode.workspace.fs.readFile(file);
          const content = Buffer.from(data).toString('utf-8');
          const lines = content.split('\n');
          const relativePath = vscode.workspace.asRelativePath(file);
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= limit) break;
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              matches.push(`${relativePath}:${i + 1}: ${lines[i].trim()}`);
            }
          }
        } catch {
          // ignore unreadable files
        }
      }

      return {
        content: [{ type: 'text' as const, text: matches.join('\n') || 'No matches found.' }],
        details: {},
      };
    },
  });

  const findTool = defineTool({
    name: 'find',
    label: 'Find Files',
    description: 'Find files in the workspace matching a pattern.',
    parameters: Type.Object({
      pattern: Type.String({ description: 'Glob pattern to match files' }),
      path: Type.Optional(Type.String({ description: 'Directory to search in' })),
      limit: Type.Optional(Type.Number({ description: 'Maximum number of results' })),
    }),
    execute: async (_toolCallId, params) => {
      const searchPath = params.path ? path.resolve(cwd, params.path) : cwd;
      const uri = vscode.Uri.file(searchPath);
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(uri, params.pattern),
        '**/node_modules/**',
        params.limit ?? 100
      );

      const results = files.map((f) => vscode.workspace.asRelativePath(f));
      return {
        content: [{ type: 'text' as const, text: results.join('\n') || 'No files found.' }],
        details: {},
      };
    },
  });

  const lsTool = defineTool({
    name: 'ls',
    label: 'List Directory',
    description: 'List files and directories at the specified path.',
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: 'Relative path to directory' })),
      limit: Type.Optional(Type.Number({ description: 'Maximum number of entries' })),
    }),
    execute: async (_toolCallId, params) => {
      const dirPath = params.path ? path.resolve(cwd, params.path) : cwd;
      const uri = vscode.Uri.file(dirPath);
      const entries = await vscode.workspace.fs.readDirectory(uri);

      const lines = entries
        .slice(0, params.limit ?? 100)
        .map(([name, type]) => {
          const prefix = type === vscode.FileType.Directory ? 'd ' : 'f ';
          return `${prefix}${name}`;
        });

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') || '(empty directory)' }],
        details: {},
      };
    },
  });

  return [readTool, editTool, writeTool, bashTool, grepTool, findTool, lsTool];
}
