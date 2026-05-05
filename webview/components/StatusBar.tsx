import React from 'react';

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

interface StatusBarProps {
  model: string;
  isStreaming: boolean;
  isThinking?: boolean;
  models?: ModelInfo[];
  provider?: string;
  onModelChange?: (modelId: string) => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  model,
  isStreaming,
  isThinking,
  models = [],
  provider = '',
  onModelChange,
}) => {
  const displayModel = models.find((m) => m.id === model)?.name || model || 'No model';
  const hasModels = models.length > 0;

  return (
    <div className="status-bar">
      {hasModels && onModelChange ? (
        <div className="status-model-selector">
          <span className="status-provider">{provider}</span>
          <select
            className="status-model-select"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            title={displayModel}
          >
            <option value="">Default</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <span className="status-model">{displayModel}</span>
      )}
      {!model && !hasModels && (
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
}
