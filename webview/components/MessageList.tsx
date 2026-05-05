import React from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'error' | 'thinking';
  content: string;
  toolName?: string;
  toolArgs?: unknown;
  isStreaming?: boolean;
}

interface MessageListProps {
  messages: ChatMessage[];
}

export const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  return (
    <div className="message-list">
      {messages.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-logo">
            <svg width="40" height="40" viewBox="0 0 800 800" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fill="currentColor" fillRule="evenodd" d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z" />
              <path fill="currentColor" d="M517.36 400H634.72V634.72H517.36Z" />
            </svg>
          </div>
          <h2 className="empty-state-title">Pi Agent</h2>
          <p className="empty-state-desc">Your AI coding assistant. Ask questions, edit code, or get help with your project.</p>
          <div className="empty-state-suggestions">
            <button className="suggestion-chip" onClick={() => {
              const input = document.getElementById('chat-input') as HTMLTextAreaElement;
              if (input) {
                input.value = 'Explain the selected code';
                input.focus();
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }}>
              Explain the selected code
            </button>
            <button className="suggestion-chip" onClick={() => {
              const input = document.getElementById('chat-input') as HTMLTextAreaElement;
              if (input) {
                input.value = 'Refactor this function';
                input.focus();
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }}>
              Refactor this function
            </button>
            <button className="suggestion-chip" onClick={() => {
              const input = document.getElementById('chat-input') as HTMLTextAreaElement;
              if (input) {
                input.value = 'Find bugs in the current file';
                input.focus();
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }}>
              Find bugs in the current file
            </button>
          </div>
        </div>
      )}
      {messages.map((msg, index) => (
        <div
          key={msg.id}
          className="message-animate-in"
          style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
        >
          <div className={`message-wrapper ${msg.role}`}>
            {msg.role === 'user' && (
              <div className="message-avatar user-avatar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
            )}
            <div className={`message-bubble ${msg.role}`}>
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
                <div className="thinking-dots">
                  <span /><span /><span />
                </div>
              ) : msg.role === 'assistant' ? (
                <>
                  <div className="message-markdown">
                    <MarkdownRenderer content={msg.content} />
                  </div>
                  {msg.isStreaming && <span className="cursor">▌</span>}
                  {!msg.isStreaming && msg.content && (
                    <div className="message-actions">
                      <button className="msg-action-btn" onClick={() => {
                        navigator.clipboard.writeText(msg.content);
                      }} title="Copy">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        <span>Copy</span>
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="user-text">{msg.content}</div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
