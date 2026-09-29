import type { ReactNode } from 'react';
import type { AgentSummary } from '../api';

type Direction = 'inbound' | 'outbound';

export type SimulatorSetupFormProps = {
  agents: AgentSummary[];
  agentId: string;
  onAgentIdChange: (id: string) => void;
  direction: Direction;
  onDirectionChange: (direction: Direction) => void;
  prospectName: string;
  onProspectNameChange: (value: string) => void;
  contactPhone: string;
  onContactPhoneChange: (value: string) => void;
  contactEmail: string;
  onContactEmailChange: (value: string) => void;
  error: string;
  starting: boolean;
  onStartCall: () => void;
  workerCommand: string;
  llmInfo?: ReactNode;
  showMicTest?: boolean;
  micTesting?: boolean;
  micTestDevice?: string;
  micTestLevelBar?: ReactNode;
  micTestError?: string;
  onTestMic?: () => void;
  generalKnowledgeEnabled?: boolean;
};

export default function SimulatorSetupForm({
  agents,
  agentId,
  onAgentIdChange,
  direction,
  onDirectionChange,
  prospectName,
  onProspectNameChange,
  contactPhone,
  onContactPhoneChange,
  contactEmail,
  onContactEmailChange,
  error,
  starting,
  onStartCall,
  workerCommand,
  llmInfo,
  showMicTest,
  micTesting,
  micTestDevice,
  micTestLevelBar,
  micTestError,
  onTestMic,
  generalKnowledgeEnabled,
}: SimulatorSetupFormProps) {
  const selected = agents.find((a) => a.id === agentId);

  return (
    <div className="sim-setup">
      <div className="sim-setup-grid">
        <section className="sim-setup-panel">
          <div className="sim-setup-panel-head">
            <span className="sim-setup-panel-icon" aria-hidden>
              🤖
            </span>
            <div>
              <h2 className="sim-setup-panel-title">Call configuration</h2>
              <p className="sim-setup-panel-desc">Choose agent and call direction.</p>
            </div>
          </div>

          <div className="studio-field">
            <label htmlFor="simAgent">Agent</label>
            <select id="simAgent" value={agentId} onChange={(e) => onAgentIdChange(e.target.value)}>
              <option value="">Select agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {agentId && selected && (
            <p className="studio-field-hint">
              Voice pipeline from Agent Studio:{' '}
              <strong>{(selected.voicePipeline ?? 'gemini_live').replace(/_/g, ' ')}</strong>
              {selected.realtimeVoice ? ` · ${selected.realtimeVoice}` : ''}. Change it under Studio
              → Voice.
            </p>
          )}

          {agentId && (
            <div className="sim-llm-badge" title="Set in Agent Studio → Product knowledge">
              General knowledge:{' '}
              <strong>{generalKnowledgeEnabled !== false ? 'ON' : 'OFF'}</strong>
              {generalKnowledgeEnabled === false
                ? ' — prompt/Brain only'
                : ' — fill gaps from LLM'}
            </div>
          )}

          {llmInfo && <div className="sim-llm-badge">{llmInfo}</div>}

          <p className="sim-setup-label">Call type</p>
          <div className="studio-choice-grid">
            <button
              type="button"
              className={`studio-choice-card${direction === 'inbound' ? ' selected' : ''}`}
              onClick={() => onDirectionChange('inbound')}
            >
              <strong>📲 Incoming</strong>
              <span>You speak first — like answering a sales call</span>
            </button>
            <button
              type="button"
              className={`studio-choice-card${direction === 'outbound' ? ' selected' : ''}`}
              onClick={() => onDirectionChange('outbound')}
            >
              <strong>📤 Outgoing</strong>
              <span>Agent speaks first — like a cold outbound dial</span>
            </button>
          </div>
        </section>

        <section className="sim-setup-panel">
          <div className="sim-setup-panel-head">
            <span className="sim-setup-panel-icon" aria-hidden>
              👤
            </span>
            <div>
              <h2 className="sim-setup-panel-title">Contact details</h2>
              <p className="sim-setup-panel-desc">Optional — used for prospect memory and context.</p>
            </div>
          </div>

          <div className="studio-field-grid studio-field-grid--single">
            <div className="studio-field">
              <label htmlFor="simProspect">
                {direction === 'outbound' ? 'Prospect name' : 'Caller name'}
              </label>
              <input
                id="simProspect"
                type="text"
                value={prospectName}
                onChange={(e) => onProspectNameChange(e.target.value)}
                placeholder={direction === 'outbound' ? 'e.g. Rahul Sharma' : 'Returning caller name'}
              />
            </div>
            <div className="studio-field">
              <label htmlFor="simPhone">
                {direction === 'outbound' ? 'Dialed phone' : 'Caller phone'}
              </label>
              <input
                id="simPhone"
                type="tel"
                value={contactPhone}
                onChange={(e) => onContactPhoneChange(e.target.value)}
                placeholder="e.g. +91 98765 43210"
              />
            </div>
            <div className="studio-field">
              <label htmlFor="simEmail">Email on file</label>
              <input
                id="simEmail"
                type="email"
                value={contactEmail}
                onChange={(e) => onContactEmailChange(e.target.value)}
                placeholder="optional"
              />
            </div>
          </div>
        </section>
      </div>

      {error && <p className="error">{error}</p>}

      {showMicTest && onTestMic && (
        <div className="sim-mic-test">
          <button type="button" className="btn secondary" onClick={onTestMic} disabled={micTesting}>
            {micTesting ? 'Testing mic…' : 'Test microphone'}
          </button>
          {micTestDevice && <p className="sim-hint">Device: {micTestDevice}</p>}
          {micTestLevelBar}
          {micTestError && <p className="error">{micTestError}</p>}
        </div>
      )}

      <div className="sim-setup-actions">
        <button type="button" className="btn primary" onClick={onStartCall} disabled={starting || !agentId}>
          {starting ? 'Starting…' : 'Start call'}
        </button>
        <p className="sim-hint">
          Worker: <code>{workerCommand}</code>
        </p>
      </div>
    </div>
  );
}
