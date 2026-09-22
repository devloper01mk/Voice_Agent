import {
  GEMINI_LIVE_LANGUAGE_OPTIONS,
  GEMINI_LIVE_MODEL_OPTIONS,
  GEMINI_LIVE_VOICE_OPTIONS,
  GEMINI_31_BRIGHT_VOICES,
  GEMINI_31_WARM_VOICE_HINTS,
  REALTIME_S2S_EAGERNESS_OPTIONS,
  REALTIME_S2S_MODEL_OPTIONS,
  REALTIME_S2S_NOISE_REDUCTION_OPTIONS,
  REALTIME_S2S_TRANSCRIPTION_OPTIONS,
  REALTIME_S2S_TURN_MODE_OPTIONS,
  REALTIME_VOICE_OPTIONS,
  defaultGeminiLiveS2sUserConfig,
  defaultRealtimeS2sUserConfig,
  estimateRealtimeS2sCostInr,
  isGemini31LiveModel,
  resolveGeminiLiveModel,
  type RealtimeS2sUserConfig,
  type S2sProvider,
  type VoicePipeline,
} from '@vsa/shared';

type Props = {
  config: RealtimeS2sUserConfig;
  onChange: (config: RealtimeS2sUserConfig) => void;
  disabled?: boolean;
  /** When set, locks provider to the pipeline (hides provider picker). */
  pipeline?: VoicePipeline;
};

function updateField<K extends keyof RealtimeS2sUserConfig>(
  config: RealtimeS2sUserConfig,
  onChange: Props['onChange'],
  key: K,
  value: RealtimeS2sUserConfig[K],
) {
  onChange({ ...config, [key]: value });
}

function voiceOptionLabel(v: { label: string; gender?: string; hint?: string }) {
  const tag = v.gender === 'female' ? ' ♀' : v.gender === 'male' ? ' ♂' : '';
  return `${v.label}${tag}${v.hint ? ` — ${v.hint}` : ''}`;
}

function providerFromPipeline(pipeline?: VoicePipeline): S2sProvider | null {
  if (pipeline === 'gemini_live') return 'gemini';
  if (pipeline === 'openai_realtime') return 'openai';
  return null;
}

export default function RealtimeS2sSettingsForm({ config, onChange, disabled, pipeline }: Props) {
  const lockedProvider = providerFromPipeline(pipeline);
  const provider = lockedProvider ?? config.provider;
  const isGemini = provider === 'gemini';
  const semanticTurn = config.turnDetectionMode === 'semantic';

  const femaleVoices = isGemini
    ? GEMINI_LIVE_VOICE_OPTIONS.filter((v) => v.gender === 'female')
    : REALTIME_VOICE_OPTIONS.filter((v) => v.gender === 'female');
  const otherVoices = isGemini
    ? GEMINI_LIVE_VOICE_OPTIONS.filter((v) => v.gender !== 'female')
    : REALTIME_VOICE_OPTIONS.filter((v) => v.gender !== 'female');

  function switchProvider(next: S2sProvider) {
    if (lockedProvider) return;
    onChange(next === 'gemini' ? defaultGeminiLiveS2sUserConfig() : defaultRealtimeS2sUserConfig());
  }

  return (
    <div className="sim-s2s-settings">
      <p className="studio-field-hint sim-s2s-settings-intro">
        Est. API cost: <strong>{estimateRealtimeS2sCostInr(config)}/min</strong> (varies by talk time)
      </p>

      {!lockedProvider && (
        <div className="studio-field">
          <label htmlFor="s2sProvider">S2S provider</label>
          <select
            id="s2sProvider"
            value={provider}
            disabled={disabled}
            onChange={(e) => switchProvider(e.target.value as S2sProvider)}
          >
            <option value="openai">OpenAI Realtime</option>
            <option value="gemini">Gemini Live</option>
          </select>
        </div>
      )}

      <div className="studio-field-grid">
        <div className="studio-field">
          <label htmlFor="s2sModel">Model</label>
          <select
            id="s2sModel"
            value={isGemini ? resolveGeminiLiveModel(config.model) : config.model}
            disabled={disabled}
            onChange={(e) => {
              const model = e.target.value;
              if (isGemini && isGemini31LiveModel(model) && GEMINI_31_BRIGHT_VOICES.has(config.voice)) {
                onChange({
                  ...config,
                  model,
                  voice: 'Gacrux',
                });
                return;
              }
              updateField(config, onChange, 'model', model);
            }}
          >
            {(isGemini ? GEMINI_LIVE_MODEL_OPTIONS : REALTIME_S2S_MODEL_OPTIONS).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {'hint' in o && o.hint ? ` — ${o.hint}` : ''}
              </option>
            ))}
          </select>
        </div>

        {isGemini ? (
          <div className="studio-field">
            <label htmlFor="s2sLanguage">Speech language</label>
            <select
              id="s2sLanguage"
              value={config.languageCode}
              disabled={disabled}
              onChange={(e) => updateField(config, onChange, 'languageCode', e.target.value)}
            >
              {GEMINI_LIVE_LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                  {'hint' in o && o.hint ? ` — ${o.hint}` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="studio-field">
            <label htmlFor="s2sTranscriptModel">User transcript model</label>
            <select
              id="s2sTranscriptModel"
              value={config.transcriptionModel}
              disabled={disabled}
              onChange={(e) => updateField(config, onChange, 'transcriptionModel', e.target.value)}
            >
              {REALTIME_S2S_TRANSCRIPTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="studio-field">
          <label htmlFor="s2sVoice">Voice (female recommended)</label>
          <select
            id="s2sVoice"
            value={config.voice}
            disabled={disabled}
            onChange={(e) => updateField(config, onChange, 'voice', e.target.value)}
          >
            <optgroup label="Female voices">
              {femaleVoices.map((v) => (
                <option key={v.value} value={v.value}>
                  {voiceOptionLabel(v)}
                </option>
              ))}
            </optgroup>
            <optgroup label="Other voices">
              {otherVoices.map((v) => (
                <option key={v.value} value={v.value}>
                  {voiceOptionLabel(v)}
                </option>
              ))}
            </optgroup>
          </select>
          <p className="studio-field-hint">
            {isGemini ? (
              isGemini31LiveModel(config.model) ? (
                <>
                  Gemini 3.1 often sounds brighter/higher. Prefer{' '}
                  <strong>{GEMINI_31_WARM_VOICE_HINTS.slice(0, 4).join(', ')}</strong> — avoid thin
                  bright voices
                  {GEMINI_31_BRIGHT_VOICES.has(config.voice)
                    ? ` (current: ${config.voice})`
                    : ''}
                  . Live API has no pitch slider.
                </>
              ) : (
                <>
                  <strong>Kore</strong> or <strong>Aoede</strong> for female Gemini Live. Hindi/Hinglish
                  ke liye language <strong>hi-IN</strong> set karo — accent global HD hai, pure desi nahi.
                </>
              )
            ) : (
              <>
                <strong>Coral</strong> or <strong>Shimmer</strong> for female S2S. Accent US/generic hai —
                Indian female Hinglish ke liye <strong>Cascaded + Cartesia (Arushi)</strong> use karo.
              </>
            )}
          </p>
        </div>

        {!isGemini && (
          <div className="studio-field">
            <label htmlFor="s2sNoise">Noise reduction</label>
            <select
              id="s2sNoise"
              value={config.noiseReduction}
              disabled={disabled}
              onChange={(e) =>
                updateField(
                  config,
                  onChange,
                  'noiseReduction',
                  e.target.value as RealtimeS2sUserConfig['noiseReduction'],
                )
              }
            >
              {REALTIME_S2S_NOISE_REDUCTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="studio-field">
        <span className="studio-field-label">Max tokens</span>
        <div className="studio-choice-grid studio-choice-grid--compact">
          <button
            type="button"
            className={`studio-choice-card${config.maxTokensMode === 'unlimited' ? ' selected' : ''}`}
            disabled={disabled}
            onClick={() => updateField(config, onChange, 'maxTokensMode', 'unlimited')}
          >
            <strong>Unlimited</strong>
            <span>Uses model maximum</span>
          </button>
          <button
            type="button"
            className={`studio-choice-card${config.maxTokensMode === 'custom' ? ' selected' : ''}`}
            disabled={disabled}
            onClick={() => updateField(config, onChange, 'maxTokensMode', 'custom')}
          >
            <strong>Custom</strong>
            <span>Set a token cap per reply</span>
          </button>
        </div>
        {config.maxTokensMode === 'custom' && (
          <div className="studio-field studio-field--inline">
            <label htmlFor="s2sMaxTokens">Custom max tokens</label>
            <input
              id="s2sMaxTokens"
              type="number"
              min={64}
              max={16384}
              step={64}
              disabled={disabled}
              value={config.maxTokensCustom}
              onChange={(e) =>
                updateField(config, onChange, 'maxTokensCustom', Number(e.target.value))
              }
            />
          </div>
        )}
      </div>

      <div className="studio-field-grid">
        <div className="studio-field">
          <label htmlFor="s2sTurnMode">Automatic turn detection</label>
          <select
            id="s2sTurnMode"
            value={config.turnDetectionMode}
            disabled={disabled}
            onChange={(e) =>
              updateField(
                config,
                onChange,
                'turnDetectionMode',
                e.target.value as RealtimeS2sUserConfig['turnDetectionMode'],
              )
            }
          >
            {REALTIME_S2S_TURN_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {semanticTurn && !isGemini ? (
          <div className="studio-field">
            <label htmlFor="s2sEagerness">Eagerness</label>
            <select
              id="s2sEagerness"
              value={config.turnDetectionEagerness}
              disabled={disabled}
              onChange={(e) =>
                updateField(
                  config,
                  onChange,
                  'turnDetectionEagerness',
                  e.target.value as RealtimeS2sUserConfig['turnDetectionEagerness'],
                )
              }
            >
              {REALTIME_S2S_EAGERNESS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div className="studio-field">
              <label htmlFor="s2sThreshold">
                Threshold{' '}
                <span className="studio-field-value">{config.turnDetectionThreshold.toFixed(2)}</span>
              </label>
              <input
                id="s2sThreshold"
                type="range"
                min={0}
                max={1}
                step={0.01}
                disabled={disabled}
                value={config.turnDetectionThreshold}
                onChange={(e) =>
                  updateField(config, onChange, 'turnDetectionThreshold', Number(e.target.value))
                }
              />
            </div>

            <div className="studio-field">
              <label htmlFor="s2sPrefix">
                Prefix padding{' '}
                <span className="studio-field-value">{config.turnDetectionPrefixPaddingMs} ms</span>
              </label>
              <input
                id="s2sPrefix"
                type="range"
                min={0}
                max={2000}
                step={50}
                disabled={disabled}
                value={config.turnDetectionPrefixPaddingMs}
                onChange={(e) =>
                  updateField(
                    config,
                    onChange,
                    'turnDetectionPrefixPaddingMs',
                    Number(e.target.value),
                  )
                }
              />
            </div>

            <div className="studio-field">
              <label htmlFor="s2sSilence">
                Silence duration{' '}
                <span className="studio-field-value">{config.turnDetectionSilenceDurationMs} ms</span>
              </label>
              <input
                id="s2sSilence"
                type="range"
                min={0}
                max={3000}
                step={50}
                disabled={disabled}
                value={config.turnDetectionSilenceDurationMs}
                onChange={(e) =>
                  updateField(
                    config,
                    onChange,
                    'turnDetectionSilenceDurationMs',
                    Number(e.target.value),
                  )
                }
              />
            </div>
          </>
        )}
      </div>

      <div className="studio-field studio-field--toggle">
        <label className="studio-toggle-row" htmlFor="s2sIdleTimeout">
          <span>Idle timeout</span>
          <input
            id="s2sIdleTimeout"
            type="checkbox"
            checked={config.idleTimeoutEnabled}
            disabled={disabled}
            onChange={(e) => updateField(config, onChange, 'idleTimeoutEnabled', e.target.checked)}
          />
        </label>
        <p className="studio-field-hint">
          UI preference — {isGemini ? 'Gemini Live' : 'OpenAI Realtime'} idle timeout is not wired yet.
        </p>
      </div>
    </div>
  );
}
