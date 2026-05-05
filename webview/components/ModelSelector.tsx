import React from 'react';

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

interface ModelSelectorProps {
  models: ModelInfo[];
  currentModel: string;
  provider: string;
  onChange: (modelId: string) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  currentModel,
  provider,
  onChange,
}) => {
  const displayModel = models.find((m) => m.id === currentModel)?.name || currentModel || 'Default';

  return (
    <div className="model-selector">
      <span className="model-selector-label">{provider}</span>
      <select
        className="model-selector-select"
        value={currentModel}
        onChange={(e) => onChange(e.target.value)}
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
  );
};
