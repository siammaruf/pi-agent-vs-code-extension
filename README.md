# Pi Agent — VS Code Extension

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/siammaruf/pi-agent-vs-code-extension)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.95.0-blue.svg)](https://code.visualstudio.com/)

**Pi Agent** is an AI-powered coding assistant integrated directly into Visual Studio Code. It leverages the [Pi Coding Agent](https://github.com/mariozechner/pi-coding-agent) engine to provide intelligent code generation, refactoring, explanation, and conversational assistance — all without leaving your editor.

---

## Table of Contents

- [Features](#features)
- [Supported Providers](#supported-providers)
- [Installation](#installation)
- [Configuration](#configuration)
- [Commands & Keybindings](#commands--keybindings)
- [Usage](#usage)
- [Architecture](#architecture)
- [Development](#development)
- [Building & Packaging](#building--packaging)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Multi-Provider LLM Support** — Connect to Anthropic, OpenAI, OpenRouter, Google Gemini, or any custom OpenAI-compatible endpoint.
- **Interactive Chat Interface** — A polished React-based webview UI with markdown rendering, syntax highlighting, and file attachments.
- **Context-Aware Assistance** — Automatically includes open files, selected code, and workspace context in conversations.
- **Inline Diff Proposals** — AI-generated code changes are presented as reviewable diffs with one-click accept/reject.
- **Session Management** — Persistent conversation history per workspace with the ability to switch, rename, and delete sessions.
- **Flexible Thinking Levels** — Control the reasoning depth (`off` to `xhigh`) for supported models.
- **Sidebar & Panel Modes** — Open Pi Agent in the Activity Bar sidebar or as a bottom panel, whichever fits your workflow.
- **@-Mention Files** — Reference specific files in your workspace by typing `@` in the chat input.
- **Keyboard-Driven** — Comprehensive keybindings for power users.

---

## Supported Providers

| Provider | Description |
|----------|-------------|
| **Anthropic** | Claude models via Anthropic API |
| **OpenAI** | GPT models via OpenAI API |
| **OpenRouter** | Access to hundreds of models through a unified API |
| **Google / Gemini** | Gemini models via Google AI Studio |
| **Custom** | Any OpenAI-compatible API endpoint |

---

## Installation

### From VSIX (Manual)

1. Download the latest `.vsix` from the [Releases](https://github.com/siammaruf/pi-agent-vs-code-extension/releases) page.
2. Open VS Code.
3. Go to **Extensions** → **...** (top-right) → **Install from VSIX...**
4. Select the downloaded file.

### From Source

```bash
# Clone the repository
git clone https://github.com/siammaruf/pi-agent-vs-code-extension.git
cd pi-agent-vs-code-extension

# Install dependencies
npm install

# Build the extension
npm run build

# Open in VS Code and press F5 to launch the Extension Development Host
```

---

## Configuration

All settings are available under **`Settings → Extensions → Pi Agent`**.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `piAgent.provider` | `string` | `anthropic` | LLM provider (anthropic, openai, openrouter, gemini, google, custom) |
| `piAgent.model` | `string` | *(auto)* | Specific model ID. Leave empty to use the provider's default. |
| `piAgent.thinkingLevel` | `string` | `medium` | Reasoning depth: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `piAgent.autoSave` | `boolean` | `true` | Automatically save files after applying AI edits |
| `piAgent.useCtrlEnterToSend` | `boolean` | `false` | Use `Ctrl+Enter` (or `Cmd+Enter`) to send messages instead of `Enter` |
| `piAgent.preferredLocation` | `string` | `sidebar` | Default opening location: `sidebar` or `panel` |
| `piAgent.enableNewConversationShortcut` | `boolean` | `true` | Enable `Ctrl+N` shortcut for new conversation when focused |

### Setting Your API Key

The first time you use Pi Agent, you will be prompted to enter your API key. You can also set it manually via:

- **Command Palette** → `Pi Agent: Set API Key`
- Or directly in VS Code's secure secret storage.

---

## Commands & Keybindings

All commands are accessible from the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`).

| Command | Title | Default Keybinding |
|---------|-------|--------------------|
| `pi-agent.open` | Pi Agent: Open in Panel | `Ctrl+Shift+P` / `Cmd+Shift+P` |
| `pi-agent.openSidebar` | Pi Agent: Open in Sidebar | — |
| `pi-agent.newConversation` | Pi Agent: New Conversation | `Ctrl+N` / `Cmd+N` *(when focused)* |
| `pi-agent.focusInput` | Pi Agent: Focus Input | `Ctrl+Shift+I` / `Cmd+Shift+I` |
| `pi-agent.insertAtMention` | Pi Agent: Insert @-Mention Reference | — |
| `pi-agent.acceptDiff` | Pi Agent: Accept Proposed Changes | — *(toolbar button)* |
| `pi-agent.rejectDiff` | Pi Agent: Reject Proposed Changes | — *(toolbar button)* |
| `pi-agent.setApiKey` | Pi Agent: Set API Key | — |
| `pi-agent.showSettings` | Pi Agent: Open Settings | — |

---

## Usage

### Starting a Conversation

1. Click the **Pi Agent** icon in the Activity Bar (or use `Pi Agent: Open in Panel`).
2. Type your question or instruction in the chat input.
3. Press `Enter` (or `Ctrl+Enter` if configured) to send.

### Referencing Files

- Type `@` in the chat to bring up the file picker.
- Selected files will be attached as context for the AI.

### Applying Code Changes

When Pi Agent suggests code edits:

1. A diff view opens showing the proposed changes.
2. Click **Accept** (checkmark) to apply, or **Reject** (discard) to dismiss.
3. If `autoSave` is enabled, the file is saved automatically.

### Managing Sessions

- Conversations are persisted per workspace.
- Switch between sessions from the sidebar history.
- Start a fresh conversation anytime with `Ctrl+N` (when Pi Agent is focused).

---

## Architecture

```
pi-agent-vs-code-extension/
├── src/                          # Extension Host (Node.js)
│   ├── extension.ts              # Activation & command registration
│   ├── piSessionManager.ts       # Pi agent session orchestration
│   ├── sessionManager.ts         # Conversation metadata persistence
│   ├── webviewProvider.ts        # Panel webview provider
│   ├── sidebarProvider.ts        # Sidebar webview provider
│   ├── contextProvider.ts        # Workspace & editor context gathering
│   ├── diffManager.ts            # Proposed diff lifecycle
│   ├── configurationManager.ts   # Settings & API key management
│   ├── toolProxy.ts              # LLM tool execution proxy
│   ├── protocol.ts               # Message protocol helpers
│   └── types.ts                  # Shared TypeScript definitions
├── webview/                      # React Webview UI
│   ├── App.tsx                   # Root component
│   ├── components/               # UI components (chat, settings, etc.)
│   ├── hooks/                    # Custom React hooks
│   ├── styles/                   # Global CSS
│   └── vscodeApi.ts              # VS Code webview API bridge
├── resources/                    # Icons & logos
├── scripts/                      # Build helper scripts
├── package.json                  # Extension manifest
├── tsconfig.json                 # Extension TS config
├── tsconfig.webview.json         # Webview TS config
└── webpack.webview.config.cjs    # Webview bundler config
```

### Communication Flow

```
┌─────────────────┐      Webview Protocol      ┌──────────────────┐
│  React Webview  │  ←────────────────────→   │  Extension Host  │
│  (webview/)     │    JSON messages over     │  (src/)          │
└─────────────────┘       VS Code API          └──────────────────┘
                                                        │
                                                        ▼
                                               ┌──────────────────┐
                                               │  Pi Agent Engine │
                                               │  (@mariozechner/ │
                                               │   pi-coding-agent)│
                                               └──────────────────┘
```

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [VS Code](https://code.visualstudio.com/) ≥ 1.95
- npm (comes with Node.js)

### Setup

```bash
# Install dependencies
npm install

# Run the extension in development mode
# This opens a new VS Code window with the extension loaded
npm run watch          # Watch extension host
npm run watch:webview  # Watch webview (in another terminal)
```

Then press `F5` in VS Code to launch the **Extension Development Host**.

### Linting

```bash
npm run lint
```

---

## Building & Packaging

### Production Build

```bash
npm run build
```

This generates:
- `out/extension.js` — Bundled extension host
- `out/webview/` — Bundled webview assets

### VSIX Package

```bash
npm run vscode:prepublish
npx vsce package
```

The `.vsix` file can be installed manually or published to the VS Code Marketplace.

---

## Contributing

Contributions are welcome! Please follow these steps:

1. **Fork** the repository.
2. **Create a branch** from `dev`:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** and ensure `npm run lint` passes.
4. **Commit** with clear, descriptive messages.
5. **Push** to your fork and open a **Pull Request** targeting the `dev` branch.

> **Note:** The `main` branch is protected and requires PR reviews. All development work should target `dev`.

### Reporting Issues

If you encounter a bug or have a feature request, please [open an issue](https://github.com/siammaruf/pi-agent-vs-code-extension/issues) with:
- A clear description of the problem or idea
- Steps to reproduce (for bugs)
- Your VS Code version and OS

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Acknowledgments

- Powered by the incredible [Pi Coding Agent](https://github.com/mariozechner/pi-coding-agent) engine by Mario Zechner.
- Built with ❤️ for the VS Code community.

---

<p align="center">
  <sub>Made with passion by <a href="https://github.com/siammaruf">@siammaruf</a></sub>
</p>
