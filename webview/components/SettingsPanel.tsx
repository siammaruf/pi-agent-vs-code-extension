import React, { useState, useEffect } from 'react';

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  provider: string;
  model: string;
  thinkingLevel: string;
  availableModels: ModelInfo[];
  hasApiKey: boolean;
  onSetApiKey: (key: string) => void;
  onSetProvider: (provider: string) => void;
  onSetModel: (modelId: string) => void;
  onSetThinkingLevel: (level: string) => void;
}

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'google', name: 'Google' },
  { id: 'custom', name: 'Custom' },
];

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  provider,
  model,
  thinkingLevel,
  availableModels,
  hasApiKey,
  onSetApiKey,
  onSetProvider,
  onSetModel,
  onSetThinkingLevel,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setApiKeyInput('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveKey = () => {
    if (apiKeyInput.trim()) {
      onSetApiKey(apiKeyInput.trim());
      setApiKeyInput('');
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>Settings</h3>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-section">
          <label className="settings-label">API Key</label>
          <div className="settings-status">
            {hasApiKey ? (
              <span className="status-badge success">● Configured</span>
            ) : (
              <span className="status-badge warning">● Not set</span>
            )}
          </div>
          <div className="api-key-input-row">
            <input
              type={showKey ? 'text' : 'password'}
              className="settings-input"
              placeholder="Enter API key..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
            />
            <button className="settings-btn-secondary" onClick={() => setShowKey(!showKey)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <button
            className="settings-btn-primary"
            onClick={handleSaveKey}
            disabled={!apiKeyInput.trim()}
          >
            Save API Key
          </button>
        </div>

        <div className="settings-section">
          <label className="settings-label">Provider</label>
          <select
            className="settings-select"
            value={provider}
            onChange={(e) => onSetProvider(e.target.value)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-section">
          <label className="settings-label">Model</label>
          <select
            className="settings-select"
            value={model}
            onChange={(e) => onSetModel(e.target.value)}
          >
            {availableModels.length === 0 && <option value="">Default</option>}
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-section">
          <label className="settings-label">Thinking Level</label>
          <select
            className="settings-select"
            value={thinkingLevel}
            onChange={(e) => onSetThinkingLevel(e.target.value)}
          >
            {THINKING_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
