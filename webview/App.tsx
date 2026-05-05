import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useExtensionHost, useExtensionMessages } from './hooks/useExtensionHost';
import { MessageList } from './components/MessageList';
import { InputBox, AttachedContext } from './components/InputBox';
import { StatusBar } from './components/StatusBar';
import { SettingsPanel } from './components/SettingsPanel';
import { ModelSelector } from './components/ModelSelector';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'error' | 'thinking';
  content: string;
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
  const [model, setModel] = useState<string>('');
  const [providerState, setProviderState] = useState<ProviderState>({
    provider: 'anthropic',
    model: '',
    thinkingLevel: 'medium',
    availableModels: [],
  });
  const [hasApiKey, setHasApiKey] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [attachedContext, setAttachedContext] = useState<AttachedContext[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { postMessage } = useExtensionHost();
  const currentMessageRef = useRef<ChatMessage | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      case 'sessionState':
        setIsStreaming(msg.isStreaming);
        if (msg.model?.name) {
          setModel(msg.model.name);
        }
        break;
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
        setModel(msg.model || '');
        break;
      case 'authStatus':
        setHasApiKey(msg.hasApiKey);
        break;
    }
  });

  const handlePiEvent = useCallback((event: any) => {
    switch (event.type) {
      case 'error': {
        setIsStreaming(false);
        setIsThinking(false);
        setErrorBanner(event.message || 'An error occurred');
        setMessages((prev) => {
          // Remove any pending thinking message
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
        setIsStreaming(true);
        setIsThinking(false);
        setErrorBanner(null);
        break;
      case 'agent_end':
        setIsStreaming(false);
        setIsThinking(false);
        currentMessageRef.current = null;
        break;
      case 'message_start': {
        const newMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: event.message?.role === 'user' ? 'user' : 'assistant',
          content: '',
          isStreaming: true,
        };
        currentMessageRef.current = newMsg;
        setMessages((prev) => {
          // Remove thinking indicator when real message starts
          const filtered = prev.filter((m) => m.role !== 'thinking');
          return [...filtered, newMsg];
        });
        break;
      }
      case 'message_update': {
        const delta = event.assistantMessageEvent;
        if (delta?.type === 'text_delta') {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.isStreaming) {
              const updated = { ...last, content: last.content + delta.delta };
              currentMessageRef.current = updated;
              return [...prev.slice(0, -1), updated];
            }
            return prev;
          });
        }
        break;
      }
      case 'message_end': {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming) {
            const updated = { ...last, isStreaming: false };
            currentMessageRef.current = null;
            return [...prev.slice(0, -1), updated];
          }
          return prev;
        });
        break;
      }
      case 'tool_execution_start': {
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
    }
  }, []);

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
      ]);
      // Show thinking indicator after a short delay if no response yet
      setIsThinking(true);
      setTimeout(() => {
        setIsThinking((current) => {
          if (current) {
            setMessages((prevMsgs) => {
              // Only add if no assistant message has started
              const last = prevMsgs[prevMsgs.length - 1];
              if (last?.role === 'user') {
                return [...prevMsgs, { id: `thinking-${Date.now()}`, role: 'thinking', content: '' }];
              }
              return prevMsgs;
            });
          }
          return current;
        });
      }, 600);
      postMessage({ type: 'sendMessage', text: fullText });
    },
    [postMessage, attachedContext, providerState.model]
  );

  const handleAbort = useCallback(() => {
    postMessage({ type: 'abort' });
    setIsThinking(false);
    setMessages((prev) => prev.filter((m) => m.role !== 'thinking'));
  }, [postMessage]);

  const handleNewConversation = useCallback(() => {
    postMessage({ type: 'newConversation' });
  }, [postMessage]);

  const handleSetApiKey = useCallback((key: string) => {
    postMessage({ type: 'setApiKey', apiKey: key });
  }, [postMessage]);

  const handleSetProvider = useCallback((provider: string) => {
    postMessage({ type: 'setProvider', provider });
  }, [postMessage]);

  const handleSetModel = useCallback((modelId: string) => {
    postMessage({ type: 'setModel', modelId });
  }, [postMessage]);

  const handleSetThinkingLevel = useCallback((level: string) => {
    postMessage({ type: 'setThinkingLevel', level });
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
          <ModelSelector
            models={providerState.availableModels}
            currentModel={providerState.model}
            provider={providerState.provider}
            onChange={handleSetModel}
          />
        </div>
        <div className="header-actions">
          <button
            className="header-btn"
            onClick={() => setSettingsOpen(true)}
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
        <StatusBar model={model} isStreaming={isStreaming} isThinking={isThinking} />
      </div>

      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        provider={providerState.provider}
        model={providerState.model}
        thinkingLevel={providerState.thinkingLevel}
        availableModels={providerState.availableModels}
        hasApiKey={hasApiKey}
        onSetApiKey={handleSetApiKey}
        onSetProvider={handleSetProvider}
        onSetModel={handleSetModel}
        onSetThinkingLevel={handleSetThinkingLevel}
      />
    </div>
  );
}
