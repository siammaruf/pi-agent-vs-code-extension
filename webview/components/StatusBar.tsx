import React from 'react';

interface StatusBarProps {
  model: string;
  isStreaming: boolean;
  isThinking?: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({ model, isStreaming, isThinking }) => {
  return (
    <div className="status-bar">
      <span className="status-model">{model || 'No model'}</span>
      {!model && (
        <span className="status-warning">
          Select a model to chat
        </span>
      )}
      {model && isThinking && !isStreaming && (
        <span className="status-thinking">
          <span className="thinking-dot" />
          Thinking...
        </span>
      )}
      {model && isStreaming && (
        <span className="status-streaming">
          <span className="streaming-dot" />
          Responding...
        </span>
      )}
    </div>
  );
};
