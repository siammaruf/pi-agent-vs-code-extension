import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useExtensionHost, useExtensionMessages } from './hooks/useExtensionHost';
import { MessageList } from './components/MessageList';
import { InputBox, AttachedContext } from './components/InputBox';
import { StatusBar } from './components/StatusBar';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'error' | 'thinking';
  content: string;
  reasoningContent?: string;
  toolName?: string;
  toolArgs?: unknown;
  isStreaming?: boolean;
}

interface ProviderState {
  provider: string;
  model: string;
  thinkingLevel: string;
  availableModels: Array<{ id: string; name: string; provider: string }>;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [providerState, setProviderState] = useState<ProviderState>({
    provider: 'anthropic',
    model: '',
    thinkingLevel: 'medium',
    availableModels: [],
  });
  const [hasApiKey, setHasApiKey] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [attachedContext, setAttachedContext] = useState<AttachedContext[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { postMessage } = useExtensionHost();
  const currentMessageRef = useRef<ChatMessage | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Helper to extract text/reasoning from SDK assistant messages
  const extractAssistantContent = useCallback((msg: any): { text: string; reasoning: string } => {
    let text = '';
    let reasoning = '';
    if (msg?.role === 'assistant') {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') text += block.text || '';
          else if (block.type === 'thinking') reasoning += block.thinking || '';
        }
      } else if (typeof msg.content === 'string') {
        text = msg.content;
      }
    }
    return { text, reasoning };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Request initial state
  useEffect(() => {
    postMessage({ type: 'getProviderState' });
    postMessage({ type: 'getAuthStatus' });
  }, [postMessage]);

  useExtensionMessages((msg: any) => {
    switch (msg.type) {
      case 'piEvent':
        handlePiEvent(msg.event);
        break;
      case 'sessionState': {
        setIsStreaming(msg.isStreaming);
        // Sync messages from session state to recover after reload or missed events
        if (Array.isArray(msg.messages)) {
          const synced: ChatMessage[] = msg.messages.map((m: any, idx: number) => {
            const base: ChatMessage = {
              id: m.id || `sync-${idx}-${Date.now()}`,
              role: m.role === 'user' ? 'user' : m.role === 'toolResult' ? 'tool' : 'assistant',
              content: '',
              isStreaming: false,
            };
            if (m.role === 'user') {
              if (typeof m.content === 'string') {
                base.content = m.content;
              } else if (Array.isArray(m.content)) {
                base.content = m.content.map((c: any) => c.text || '').join('');
              }
            } else if (m.role === 'assistant') {
              if (Array.isArray(m.content)) {
                const textParts: string[] = [];
                const reasoningParts: string[] = [];
                for (const part of m.content) {
                  if (part.type === 'text') textParts.push(part.text || '');
                  else if (part.type === 'thinking') reasoningParts.push(part.thinking || '');
                }
                base.content = textParts.join('');
                base.reasoningContent = reasoningParts.join('');
              } else if (typeof m.content === 'string') {
                base.content = m.content;
              }
            } else if (m.role === 'toolResult') {
              base.role = 'tool';
              base.toolName = m.toolName || '';
              if (Array.isArray(m.content)) {
                base.content = m.content.map((c: any) => c.text || '').join('\n');
              } else if (typeof m.content === 'string') {
                base.content = m.content;
              }
            }
            return base;
          }).filter((m: ChatMessage) => m.role !== 'thinking')
            .filter((m: ChatMessage) => !(m.role === 'assistant' && !m.content?.trim() && !m.reasoningContent?.trim()));
          setMessages(synced);
        }
        break;
      }
      case 'newConversation':
        setMessages([]);
        setIsStreaming(false);
        setIsThinking(false);
        setErrorBanner(null);
        break;
      case 'focusInput':
        document.getElementById('chat-input')?.focus();
        break;
      case 'insertAtMention':
        // TODO: insert @ mention into input
        break;
      case 'selection': {
        const newCtx: AttachedContext = {
          id: `ctx-${Date.now()}`,
          text: msg.text,
          file: msg.file,
          range: msg.range,
        };
        setAttachedContext((prev) => [...prev, newCtx]);
        break;
      }
      case 'providerState':
        setProviderState({
          provider: msg.provider || 'anthropic',
          model: msg.model || '',
          thinkingLevel: msg.thinkingLevel || 'medium',
          availableModels: msg.availableModels || [],
        });
        break;
      case 'authStatus':
        setHasApiKey(msg.hasApiKey);
        if (msg.hasApiKey) {
          postMessage({ type: 'getProviderState' });
        }
        break;
    }
  });

  const handlePiEvent = useCallback((event: any) => {
    console.log('[PiAgent] Event:', event.type, event);
    switch (event.type) {
      case 'error': {
        console.error('[PiAgent] Error event:', event.message);
        setIsStreaming(false);
        setIsThinking(false);
        setErrorBanner(event.message || 'An error occurred');
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.role !== 'thinking');
          return [...filtered, {
            id: `error-${Date.now()}`,
            role: 'error',
            content: event.message || 'An error occurred',
          }];
        });
        break;
      }
      case 'agent_start':
        console.log('[PiAgent] Agent started');
        setIsStreaming(true);
        setIsThinking(false);
        setErrorBanner(null);
        // Keep thinking messages — they show the loading animation until
        // message_start fires and replaces them with the assistant message
        break;
      case 'agent_end':
        console.log('[PiAgent] Agent ended');
        setIsStreaming(false);
        setIsThinking(false);
        currentMessageRef.current = null;
        setMessages((prev) =>
          prev
            .filter((m) => m.role !== 'thinking')
            .filter((m) => !(m.role === 'assistant' && !m.content?.trim() && !m.reasoningContent?.trim()))
        );
        break;
      case 'message_start': {
        const role = event.message?.role;
        console.log('[PiAgent] Message start, role:', role, 'message:', event.message);
        // Skip user/tool messages — the webview already adds user messages locally,
        // and tool results are handled via tool_execution events.
        if (role === 'user' || role === 'toolResult') {
          break;
        }
        const { text, reasoning } = extractAssistantContent(event.message);
        const newMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: text,
          reasoningContent: reasoning,
          isStreaming: true,
        };
        console.log('[PiAgent] Creating assistant msg, initial content:', text, 'reasoning:', reasoning);
        currentMessageRef.current = newMsg;
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.role !== 'thinking');
          return [...filtered, newMsg];
        });
        break;
      }
      case 'message_update': {
        const delta = event.assistantMessageEvent;
        console.log('[PiAgent] Message update, delta type:', delta?.type, 'delta:', delta?.delta);

        let deltaHandled = false;

        // Delta-based incremental update
        if (delta?.type === 'text_delta' && typeof delta.delta === 'string') {
          deltaHandled = true;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.isStreaming && last.role === 'assistant') {
              const updated = { ...last, content: last.content + delta.delta };
              currentMessageRef.current = updated;
              return [...prev.slice(0, -1), updated];
            }
            return prev;
          });
        } else if (delta?.type === 'thinking_delta' && typeof delta.delta === 'string') {
          deltaHandled = true;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.isStreaming && last.role === 'assistant') {
              const updated = {
                ...last,
                reasoningContent: (last.reasoningContent || '') + delta.delta,
              };
              currentMessageRef.current = updated;
              return [...prev.slice(0, -1), updated];
            }
            return prev;
          });
        }

        // Fallback: if no recognized delta, parse full message content directly from SDK partial message
        if (!deltaHandled) {
          const { text, reasoning } = extractAssistantContent(event.message);
          if (text || reasoning) {
            console.log('[PiAgent] Fallback update, text:', text.slice(0, 50), 'reasoning:', reasoning.slice(0, 50));
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.isStreaming && last.role === 'assistant') {
                const updated = { ...last, content: text, reasoningContent: reasoning };
                currentMessageRef.current = updated;
                return [...prev.slice(0, -1), updated];
              }
              return prev;
            });
          }
        }
        break;
      }
      case 'message_end': {
        console.log('[PiAgent] Message end, message:', event.message);
        const { text, reasoning } = extractAssistantContent(event.message);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          // Only process if last message is an assistant message that is streaming
          if (last && last.isStreaming && last.role === 'assistant') {
            // Remove empty assistant messages (no content, no reasoning)
            if (!text?.trim() && !reasoning?.trim()) {
              console.log('[PiAgent] Removing empty assistant message');
              currentMessageRef.current = null;
              return prev.slice(0, -1);
            }
            const updated = { ...last, content: text, reasoningContent: reasoning, isStreaming: false };
            console.log('[PiAgent] Finalizing assistant msg, content length:', text.length, 'reasoning length:', reasoning.length);
            currentMessageRef.current = null;
            return [...prev.slice(0, -1), updated];
          }
          return prev;
        });
        break;
      }
      case 'tool_execution_start': {
        console.log('[PiAgent] Tool execution start:', event.toolName);
        const toolMsg: ChatMessage = {
          id: `tool-${Date.now()}`,
          role: 'tool',
          content: '',
          toolName: event.toolName,
          toolArgs: event.args,
          isStreaming: true,
        };
        setMessages((prev) => [...prev, toolMsg]);
        break;
      }
      case 'tool_execution_end': {
        console.log('[PiAgent] Tool execution end');
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'tool' && last.isStreaming) {
            const result = event.result?.content?.map((c: any) => c.text).join('\n') || '';
            return [...prev.slice(0, -1), { ...last, content: result, isStreaming: false }];
          }
          return prev;
        });
        break;
      }
      default:
        console.log('[PiAgent] Unhandled event type:', event.type);
    }
  }, [extractAssistantContent]);

  const handleSend = useCallback(
    (text: string) => {
      if (!text.trim() && attachedContext.length === 0) return;
      if (!providerState.model) {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'error',
            content: 'No model connected. Please select a model first.',
          },
        ]);
        return;
      }
      let fullText = text.trim();
      if (attachedContext.length > 0) {
        const contextParts = attachedContext.map((ctx) => {
          const fileName = ctx.file.split('/').pop()?.split('\\').pop() || ctx.file;
          return `File: ${fileName}\n\`\`\`\n${ctx.text}\n\`\`\``;
        });
        fullText = `[Context]\n${contextParts.join('\n\n')}\n[/Context]\n\n${fullText}`;
      }
      setAttachedContext([]);
      setErrorBanner(null);
      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: 'user', content: fullText },
        { id: `thinking-${Date.now()}`, role: 'thinking', content: '' },
      ]);
      setIsThinking(true);
      postMessage({ type: 'sendMessage', text: fullText });
    },
    [postMessage, attachedContext, providerState.model]
  );

  const handleAbort = useCallback(() => {
    postMessage({ type: 'abort' });
    setIsThinking(false);
    setIsStreaming(false);
    setMessages((prev) => {
      // Mark any streaming assistant message as stopped and remove thinking
      return prev
        .filter((m) => m.role !== 'thinking')
        .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
    });
    currentMessageRef.current = null;
  }, [postMessage]);

  const handleNewConversation = useCallback(() => {
    postMessage({ type: 'newConversation' });
  }, [postMessage]);

  const handleSetModel = useCallback((modelId: string) => {
    postMessage({ type: 'setModel', modelId });
  }, [postMessage]);

  const handleAttachContext = useCallback(() => {
    postMessage({ type: 'getCurrentSelection' });
  }, [postMessage]);

  const handleOpenCanvas = useCallback(() => {
    postMessage({ type: 'showNotification', message: 'Canvas feature coming soon!' });
  }, [postMessage]);

  const handleRemoveContext = useCallback((id: string) => {
    setAttachedContext((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return (
    <div className="app">
      <div className="header">
        <div className="header-left">
          <span className="title">Pi Agent</span>
        </div>
        <div className="header-actions">
          <button
            className="header-btn"
            onClick={() => postMessage({ type: 'openSidebarSettings' })}
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button className="header-btn" onClick={handleNewConversation} title="New Conversation">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="chat-container" ref={chatContainerRef}>
        <MessageList messages={messages} />
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <InputBox
          onSend={handleSend}
          onAbort={handleAbort}
          isStreaming={isStreaming || isThinking}
          onAttachContext={handleAttachContext}
          onOpenCanvas={handleOpenCanvas}
          attachedContext={attachedContext}
          onRemoveContext={handleRemoveContext}
        />
        <StatusBar
          model={providerState.model}
          isStreaming={isStreaming}
          isThinking={isThinking}
          models={providerState.availableModels}
          provider={providerState.provider}
          onModelChange={handleSetModel}
        />
      </div>


    </div>
  );
}
