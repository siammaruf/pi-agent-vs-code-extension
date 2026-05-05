import React, { useEffect, useRef, useState } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'error' | 'thinking';
  content: string;
  reasoningContent?: string;
  toolName?: string;
  toolArgs?: unknown;
  isStreaming?: boolean;
}

interface MessageListProps {
  messages: ChatMessage[];
}

const AssistantAvatar = ({ isThinking }: { isThinking?: boolean }) => (
  <div className={`message-avatar assistant-avatar ${isThinking ? 'thinking-avatar' : ''}`}>
    <svg width="20" height="20" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 2L35.5 11V29L20 38L4.5 29V11L20 2Z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round"/>
      <circle cx="20" cy="20" r="3" fill="currentColor"/>
      <circle cx="20" cy="7" r="1.5" fill="currentColor"/>
      <circle cx="32" cy="14" r="1.5" fill="currentColor"/>
      <circle cx="32" cy="26" r="1.5" fill="currentColor"/>
      <circle cx="20" cy="33" r="1.5" fill="currentColor"/>
      <circle cx="8" cy="26" r="1.5" fill="currentColor"/>
      <circle cx="8" cy="14" r="1.5" fill="currentColor"/>
    </svg>
  </div>
);

const UserAvatar = () => (
  <div className="message-avatar user-avatar">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  </div>
);

// Animated thinking indicator
const ThinkingAnimation = () => {
  return (
    <div className="thinking-animation">
      <div className="thinking-animation-dots">
        <span className="thinking-dot" />
        <span className="thinking-dot" />
        <span className="thinking-dot" />
      </div>
    </div>
  );
};

// Live reasoning stream with typing effect
const ReasoningStream = ({ text }: { text: string }) => {
  const [displayed, setDisplayed] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Show the last N characters to create a "typing at the end" effect
    setDisplayed(text);
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <div className="reasoning-stream" ref={containerRef}>
      <div className="reasoning-stream-header">
        <span className="reasoning-pulse" />
        <span>Thinking</span>
      </div>
      <div className="reasoning-stream-body">
        {displayed}
        <span className="reasoning-cursor">▋</span>
      </div>
    </div>
  );
};

// Assistant message content renderer
const AssistantMessage = ({ msg }: { msg: ChatMessage }) => {
  const hasContent = msg.content && msg.content.trim().length > 0;
  const hasReasoning = msg.reasoningContent && msg.reasoningContent.trim().length > 0;

  return (
    <>
      {/* Live reasoning while streaming */}
      {msg.isStreaming && hasReasoning && (
        <ReasoningStream text={msg.reasoningContent!} />
      )}

      {/* Main content area */}
      <div className="assistant-message-body">
        {hasContent ? (
          <MarkdownRenderer content={msg.content} />
        ) : msg.isStreaming ? (
          <ThinkingAnimation />
        ) : null}
      </div>

      {/* Streaming cursor after content */}
      {msg.isStreaming && hasContent && <span className="cursor">▋</span>}

      {/* Post-completion reasoning */}
      {!msg.isStreaming && hasReasoning && (
        <details className="message-reasoning">
          <summary>Thinking</summary>
          <div className="reasoning-body">
            <pre>{msg.reasoningContent}</pre>
          </div>
        </details>
      )}

      {/* Actions */}
      {!msg.isStreaming && hasContent && (
        <div className="message-actions">
          <button
            className="msg-action-btn"
            onClick={() => navigator.clipboard.writeText(msg.content)}
            title="Copy"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>Copy</span>
          </button>
        </div>
      )}
    </>
  );
};

export const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  return (
    <div className="message-list">
      {messages.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-logo">
            <svg width="48" height="48" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 2L35.5 11V29L20 38L4.5 29V11L20 2Z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round"/>
              <circle cx="20" cy="20" r="3" fill="currentColor"/>
              <circle cx="20" cy="7" r="1.5" fill="currentColor"/>
              <circle cx="32" cy="14" r="1.5" fill="currentColor"/>
              <circle cx="32" cy="26" r="1.5" fill="currentColor"/>
              <circle cx="20" cy="33" r="1.5" fill="currentColor"/>
              <circle cx="8" cy="26" r="1.5" fill="currentColor"/>
              <circle cx="8" cy="14" r="1.5" fill="currentColor"/>
            </svg>
          </div>
          <h2 className="empty-state-title">Pi Agent</h2>
          <p className="empty-state-desc">Your AI coding assistant. Ask questions, edit code, or get help with your project.</p>
          <div className="empty-state-suggestions">
            <button className="suggestion-chip" onClick={() => {
              const input = document.getElementById('chat-input') as HTMLTextAreaElement;
              if (input) { input.value = 'Explain the selected code'; input.focus(); input.dispatchEvent(new Event('input', { bubbles: true })); }
            }}>Explain the selected code</button>
            <button className="suggestion-chip" onClick={() => {
              const input = document.getElementById('chat-input') as HTMLTextAreaElement;
              if (input) { input.value = 'Refactor this function'; input.focus(); input.dispatchEvent(new Event('input', { bubbles: true })); }
            }}>Refactor this function</button>
            <button className="suggestion-chip" onClick={() => {
              const input = document.getElementById('chat-input') as HTMLTextAreaElement;
              if (input) { input.value = 'Find bugs in the current file'; input.focus(); input.dispatchEvent(new Event('input', { bubbles: true })); }
            }}>Find bugs in the current file</button>
          </div>
        </div>
      )}
      {messages.map((msg, index) => (
        <div
          key={msg.id}
          className="message-animate-in"
          style={{ animationDelay: msg.role === 'thinking' ? '0ms' : `${Math.min(index * 30, 300)}ms` }}
        >
          <div className={`message-row ${msg.role}`}>
            <div className="message-row-inner">
              {(msg.role === 'assistant' || msg.role === 'tool' || msg.role === 'error' || msg.role === 'thinking') && <AssistantAvatar isThinking={msg.role === 'thinking'} />}
              {msg.role === 'user' && <UserAvatar />}

              <div className={`message-content ${msg.role}`}>
                {msg.role === 'tool' ? (
                  <>
                    <div className="tool-header">
                      <span className="tool-name">{msg.toolName}</span>
                      {msg.isStreaming && <span className="tool-spinner">Running...</span>}
                    </div>
                    {msg.content && <pre className="tool-content">{msg.content}</pre>}
                  </>
                ) : msg.role === 'error' ? (
                  <div className="error-content">{msg.content}</div>
                ) : msg.role === 'thinking' ? (
                  <ThinkingAnimation />
                ) : msg.role === 'assistant' ? (
                  <AssistantMessage msg={msg} />
                ) : (
                  <div className="user-text">{msg.content}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
