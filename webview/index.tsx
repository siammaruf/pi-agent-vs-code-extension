import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { getVsCodeApi } from './vscodeApi';
import './styles/index.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}

// Notify extension host that webview is ready
const vscode = getVsCodeApi();
vscode.postMessage({ type: 'webviewReady' });
