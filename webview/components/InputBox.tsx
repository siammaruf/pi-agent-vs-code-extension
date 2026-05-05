import React, { useState, useCallback, useRef, useEffect } from 'react';

export interface AttachedContext {
  id: string;
  text: string;
  file: string;
  range: [number, number, number, number];
}

interface InputBoxProps {
  onSend: (text: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  onAttachContext: () => void;
  onOpenCanvas: () => void;
  attachedContext: AttachedContext[];
  onRemoveContext: (id: string) => void;
}

type ChatMode = 'Auto' | 'Ask' | 'Act';

const MODES: ChatMode[] = ['Auto', 'Ask', 'Act'];

export const InputBox: React.FC<InputBoxProps> = ({ onSend, onAbort, isStreaming, onAttachContext, onOpenCanvas, attachedContext, onRemoveContext }) => {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ChatMode>('Auto');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming) {
          onAbort();
        } else {
          handleSend();
        }
      }
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        setMode((prev) => {
          const idx = MODES.indexOf(prev);
          return MODES[(idx + 1) % MODES.length];
        });
      }
    },
    [handleSend, onAbort, isStreaming]
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, [text]);

  const cycleMode = useCallback(() => {
    setMode((prev) => {
      const idx = MODES.indexOf(prev);
      return MODES[(idx + 1) % MODES.length];
    });
  }, []);

  return (
    <div className="input-box">
      <div className="input-box-wrapper">
        {attachedContext.length > 0 && (
          <div className="attached-context-bar">
            {attachedContext.map((ctx) => (
              <span key={ctx.id} className="context-chip" title={ctx.file}>
                <span className="context-chip-file">{ctx.file.split('/').pop()?.split('\\').pop()}</span>
                <button className="context-chip-remove" onClick={() => onRemoveContext(ctx.id)} title="Remove">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="input-box-main">
          <textarea
            id="chat-input"
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? 'Press Enter to stop...' : 'Message Pi Agent...'}
            rows={1}
          />
        </div>
        <div className="input-toolbar">
          <div className="toolbar-left">
            <button
              className="toolbar-btn"
              title="Attach context"
              onClick={onAttachContext}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              className="toolbar-btn"
              title="Open canvas"
              onClick={onOpenCanvas}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
          <div className="toolbar-right">
            <button className="mode-btn" onClick={cycleMode} title={`Mode: ${mode}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span>{mode} mode</span>
            </button>
            <button
              className={`send-button ${isStreaming ? 'stop' : ''} ${!isStreaming && !text.trim() ? 'disabled' : ''}`}
              onClick={isStreaming ? onAbort : handleSend}
              disabled={!isStreaming && !text.trim()}
              title={isStreaming ? 'Stop' : 'Send'}
            >
              {isStreaming ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
