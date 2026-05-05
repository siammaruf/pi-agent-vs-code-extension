import type { HostToWebviewMessage, WebviewToHostMessage } from './types.js';

/**
 * Typed protocol envelope for webview ↔ extension host communication.
 */

export type ProtocolMessage =
  | ({ direction: 'host-to-webview' } & HostToWebviewMessage)
  | ({ direction: 'webview-to-host' } & WebviewToHostMessage);
