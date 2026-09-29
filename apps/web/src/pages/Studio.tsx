import {
  AGENT_RULES_MAX_CHARS,
  applyPlaybookTemplate,
  normalizePlaybook,
  resolvePlaybook,
  type SalesPlaybook,
  DEFAULT_SKILLS,
  DEFAULT_GEMINI_LIVE_VOICE,
  DEFAULT_VOICE_PIPELINE,
  defaultGeminiLiveS2sUserConfig,
  isS2sPipeline,
  mergeSkillsConfig,
  normalizeRealtimeS2sUserConfig,
  normalizeVoicePipeline,
  resolveGeminiLiveVoice,
  type RealtimeS2sUserConfig,
  type SkillsConfig,
  type VoicePipeline,
} from '@vsa/shared';
import { useEffect, useMemo, useState } from 'react';
import RealtimeS2sSettingsForm from '../components/RealtimeS2sSettingsForm';
import { BrainVisualization } from '../components/studio/BrainVisualization';
import CalendarAvailabilityPanel from '../components/studio/CalendarAvailabilityPanel';
import { SkillsEditor } from '../components/studio/SkillsEditor';
import { PlaybookPanel } from '../components/studio/PlaybookPanel';
import {
  type Agent,
  type BrainMutation,
  type ProspectMemory,
  approveMutation,
  clearBrainLearnings,
  createAgent,
  getAgent,
  getGlobalLearningStats,
  listAgents,
  listLearningAudit,
  listPendingMutations,
  listProspectMemories,
  rejectMutation,
  updateAgent,
} from '../api';

type SpeakLang = 'en' | 'hi' | 'hinglish';

function parseSpeakLanguages(raw: string): SpeakLang[] {
  const langs = raw.split(',').map((s) => s.trim().toLowerCase());
  const valid = langs.filter(
    (l): l is SpeakLang => l === 'en' || l === 'hi' || l === 'hinglish',
  );
  return valid.length ? valid : ['en', 'hi', 'hinglish'];
}

function serializeSpeakLanguages(langs: SpeakLang[]): string {
  return langs.join(',');
}

const DEFAULT_BRAIN = `# Cronberry CRM

## Overview
Cronberry CRM helps sales teams track leads, manage pipelines, and follow up faster.

## Features
- Lead & pipeline management — track deals from first touch to close
- Automated follow-up reminders and task assignment
- Email sync and activity timeline per contact
- WhatsApp integration for Indian sales teams
- Reports & dashboards for team performance

## Pricing
- **Starter** — small teams, core CRM (exact INR on request)
- **Team** — growing sales teams with collaboration features
- **Enterprise** — custom integrations and dedicated support
When the caller asks pricing, name these tiers in one sentence, then offer a quick demo or callback for an exact quote.

## Out of scope — NEVER answer
- Loans, banking, legal, medical advice
- Competitor pricing unless listed here
`;


type Tab = 'identity' | 'voice' | 'brain' | 'playbook' | 'skills' | 'calendar' | 'learnings' | 'llm';

function isSkillsConfig(raw: unknown): raw is SkillsConfig {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'demoOfferScript' in raw &&
    'busy' in raw
  );
}

function normalizeSkillsConfig(raw: unknown): SkillsConfig {
  return mergeSkillsConfig(isSkillsConfig(raw) ? raw : undefined);
}

const DEFAULT_GPT_MODEL = 'gpt-5.4-mini';

const GPT_MODEL_OPTIONS = [
  {
    value: 'gpt-5.4-mini',
    label: 'GPT-5.4 mini',
    hint: 'Newer model with stronger reasoning — best for nuanced sales calls.',
    tag: 'Recommended',
    tagTone: 'green' as const,
  },
  {
    value: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    hint: 'Lower latency and cost — good for high-volume or simpler flows.',
    tag: 'Economy',
    tagTone: 'gray' as const,
  },
] as const;

const STUDIO_TABS = [
  { id: 'identity' as Tab, label: 'Identity', icon: '👤' },
  { id: 'voice' as Tab, label: 'Voice', icon: '🎤' },
  { id: 'brain' as Tab, label: 'Brain', icon: '🧠' },
  { id: 'playbook' as Tab, label: 'Playbook', icon: '🎯' },
  { id: 'skills' as Tab, label: 'Skills', icon: '📋' },
  { id: 'calendar' as Tab, label: 'Calendar', icon: '📅' },
  { id: 'learnings' as Tab, label: 'Learnings', icon: '📚' },
  { id: 'llm' as Tab, label: 'LLM', icon: '✨' },
] as const;

const SPEAK_LANG_OPTIONS = [
  { code: 'en' as SpeakLang, label: 'English', flag: '🇬🇧' },
  { code: 'hi' as SpeakLang, label: 'Hindi', flag: '🇮🇳' },
  { code: 'hinglish' as SpeakLang, label: 'Hinglish', flag: '🔀' },
] as const;

const defaultForm = () => ({
  name: 'Maya',
  greeting:
    "Hi, main Maya bol rehi hoon Cronberry CRM se. Aap batayein — aaj features, pricing, ya demo mein se kya dekhna chahenge?",
  persona: 'friendly and professional female sales agent',
  productName: 'Cronberry CRM',
  voiceId: DEFAULT_GEMINI_LIVE_VOICE as string,
  voiceLanguage: 'en',
  voiceLanguages: 'en,hi,hinglish',
  voiceSpeed: 1,
  voicePitch: 1,
  ttsModel: 'gemini',
  ttsSampleRate: 24000,
  ttsEmotion: '',
  voicePipeline: DEFAULT_VOICE_PIPELINE as VoicePipeline,
  realtimeVoice: DEFAULT_GEMINI_LIVE_VOICE as string,
  agentGender: 'female' as 'female' | 'male',
  llmProvider: 'gpt' as const,
  llmModel: DEFAULT_GPT_MODEL,
  brainMarkdown: DEFAULT_BRAIN,
  agentRules: '',
});

/** Brain headings that look like behaviour rules — they belong in Agent rules, not searchable facts. */
function ruleLikeBrainHeadings(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => /^#{1,4}\s+(.+)$/.exec(line)?.[1]?.trim())
    .filter((h): h is string => Boolean(h) && /\b(rules?|lock|never|priority|flow|must|do not|don't|forbidden|identity)\b/i.test(h!))
    .slice(0, 8);
}

export default function StudioPage() {
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [tab, setTab] = useState<Tab>('identity');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [form, setForm] = useState(defaultForm());
  const [realtimeS2sConfig, setRealtimeS2sConfig] = useState<RealtimeS2sUserConfig>(
    defaultGeminiLiveS2sUserConfig(),
  );
  const [brainSummary, setBrainSummary] = useState('');
  const [brainLearnings, setBrainLearnings] = useState('');
  const [skillsConfig, setSkillsConfig] = useState<SkillsConfig>(DEFAULT_SKILLS);
  /** Stored playbook (null = derived from Booking policy). `playbookCleared` → send null on save. */
  const [storedPlaybook, setStoredPlaybook] = useState<SalesPlaybook | null>(null);
  const [playbookCleared, setPlaybookCleared] = useState(false);
  const playbook = useMemo(
    () => storedPlaybook ?? resolvePlaybook(null, skillsConfig.booking),
    [storedPlaybook, skillsConfig.booking],
  );
  const playbookPayload = storedPlaybook ?? (playbookCleared ? null : undefined);
  const [learningsEnabled, setLearningsEnabled] = useState(true);
  const [generalKnowledgeEnabled, setGeneralKnowledgeEnabled] = useState(true);
  const [pendingMutations, setPendingMutations] = useState<BrainMutation[]>([]);
  const [auditLog, setAuditLog] = useState<BrainMutation[]>([]);
  const [vectorCount, setVectorCount] = useState(0);
  const [prospects, setProspects] = useState<ProspectMemory[]>([]);
  const [learningsLoading, setLearningsLoading] = useState(false);
  const speakLanguages = useMemo(
    () => parseSpeakLanguages(form.voiceLanguages),
    [form.voiceLanguages],
  );

  useEffect(() => {
    listAgents()
      .then((list) => {
        setAgents(list);
        if (list[0]) setAgentId(list[0].id);
      })
      .catch(() => setMessage('Start API and database to load agents.'));
  }, []);

  useEffect(() => {
    if (!agentId) return;
    getAgent(agentId)
      .then((a: Agent) => {
        setForm({
          name: a.name,
          greeting: a.greeting,
          persona: a.persona,
          productName: a.productName,
          voiceId: resolveGeminiLiveVoice(a.realtimeVoice ?? a.voiceId),
          voiceLanguage: a.voiceLanguage ?? 'en',
          voiceLanguages: a.voiceLanguages ?? 'en,hi,hinglish',
          voiceSpeed: a.voiceSpeed,
          voicePitch: a.voicePitch ?? 1,
          ttsModel: 'gemini',
          ttsSampleRate: 24000,
          ttsEmotion: '',
          voicePipeline: normalizeVoicePipeline(a.voicePipeline),
          realtimeVoice: resolveGeminiLiveVoice(a.realtimeVoice),
          agentGender: a.agentGender === 'male' ? 'male' : 'female',
          llmProvider: 'gpt',
          llmModel: a.llmModel,
          brainMarkdown: a.brainMarkdown,
          agentRules: a.agentRules ?? '',
        });
        setRealtimeS2sConfig(
          normalizeRealtimeS2sUserConfig(
            {
              ...(a.realtimeS2sConfig ?? {}),
              voice: resolveGeminiLiveVoice(
                a.realtimeS2sConfig?.voice ?? a.realtimeVoice,
              ),
            },
            'gemini_live',
          ),
        );
        setBrainSummary(a.brainSummary ?? '');
        setBrainLearnings(a.brainLearnings ?? '');
        setLearningsEnabled(a.learningsEnabled !== false);
        setGeneralKnowledgeEnabled(a.generalKnowledgeEnabled !== false);
        setSkillsConfig(normalizeSkillsConfig(a.skillsConfig));
        setStoredPlaybook(normalizePlaybook(a.playbook));
        setPlaybookCleared(false);
      })
      .catch(() => setMessage('Failed to load agent'));
  }, [agentId]);


  const loadLearnings = async () => {
    if (!agentId) return;
    setLearningsLoading(true);
    try {
      const [held, audit, prospectList, agent, stats] = await Promise.all([
        listPendingMutations(agentId),
        listLearningAudit(agentId),
        listProspectMemories(agentId),
        getAgent(agentId),
        getGlobalLearningStats(agentId),
      ]);
      setPendingMutations(held);
      setAuditLog(audit);
      setProspects(prospectList);
      setBrainLearnings(agent.brainLearnings ?? '');
      setLearningsEnabled(agent.learningsEnabled !== false);
      setVectorCount(stats.vectorCount);
    } catch {
      setMessage('Failed to load learnings — run a call first.');
    } finally {
      setLearningsLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'learnings' || !agentId) return;
    void loadLearnings();
  }, [tab, agentId]);


  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      let saved: Agent;
      if (agentId) {
        saved = await updateAgent(agentId, {
          ...form,
          realtimeVoice: isS2sPipeline(form.voicePipeline)
            ? realtimeS2sConfig.voice
            : form.realtimeVoice,
          realtimeS2sConfig: isS2sPipeline(form.voicePipeline) ? realtimeS2sConfig : null,
          learningsEnabled,
          generalKnowledgeEnabled,
          skillsConfig,
          playbook: playbookPayload,
        });
      } else {
        saved = await createAgent({
          ...form,
          realtimeVoice: isS2sPipeline(form.voicePipeline)
            ? realtimeS2sConfig.voice
            : form.realtimeVoice,
          realtimeS2sConfig: isS2sPipeline(form.voicePipeline) ? realtimeS2sConfig : null,
          learningsEnabled,
          generalKnowledgeEnabled,
          skillsConfig,
          playbook: storedPlaybook ?? undefined,
        });
        setAgentId(saved.id);
        const list = await listAgents();
        setAgents(list);
      }
      setMessage(
        `Saved. Brain summarized with GPT. Prompt ~${saved.promptTokenCount ?? '?'} tokens.`,
      );
      setBrainSummary(saved.brainSummary ?? '');
      setBrainLearnings(saved.brainLearnings ?? '');
      setGeneralKnowledgeEnabled(saved.generalKnowledgeEnabled !== false);
      setSkillsConfig(normalizeSkillsConfig(saved.skillsConfig));
      setStoredPlaybook(normalizePlaybook(saved.playbook));
      setPlaybookCleared(false);
      const savedPipeline = normalizeVoicePipeline(saved.voicePipeline);
      if (isS2sPipeline(savedPipeline) && saved.realtimeS2sConfig) {
        setRealtimeS2sConfig(
          normalizeRealtimeS2sUserConfig(saved.realtimeS2sConfig, savedPipeline),
        );
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Save failed — check API is running.');
    } finally {
      setSaving(false);
    }
  };


  const gptModelOptions = useMemo(() => {
    const known = GPT_MODEL_OPTIONS.some((option) => option.value === form.llmModel);
    if (known) return GPT_MODEL_OPTIONS;
    return [
      ...GPT_MODEL_OPTIONS,
      { value: form.llmModel, label: `${form.llmModel} (saved)` },
    ];
  }, [form.llmModel]);




  const toggleSpeakLanguage = (lang: SpeakLang) => {
    setForm((f) => {
      const current = parseSpeakLanguages(f.voiceLanguages);
      const next = current.includes(lang)
        ? current.filter((l) => l !== lang)
        : [...current, lang];
      if (next.length === 0) return f;
      return { ...f, voiceLanguages: serializeSpeakLanguages(next) };
    });
  };


  return (
    <div className="card studio-page">
      <h1 className="page-title">
        <span className="page-icon" aria-hidden>🎙️</span>
        Agent Studio
      </h1>
      <p className="page-subtitle">
        Configure your voice agent — identity, Gemini Live voice, product knowledge, skills, and
        brain LLM. Everything compiles when you save.
      </p>

      <div className="studio-toolbar">
        <div className="studio-toolbar-field">
          <label htmlFor="agentSelect">Agent</label>
          <select
            id="agentSelect"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">— New agent —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="studio-toolbar-actions">
          <button type="button" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save agent'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setAgentId('');
              setForm(defaultForm());
              setBrainSummary('');
              setSkillsConfig(DEFAULT_SKILLS);
              setStoredPlaybook(null);
              setPlaybookCleared(false);
            }}
          >
            New
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`studio-alert ${message.includes('fail') || message.includes('Failed') ? 'studio-alert--error' : 'studio-alert--success'}`}
          role="status"
        >
          {message.includes('fail') || message.includes('Failed') ? '⚠️' : '✓'} {message}
        </div>
      )}

      <div className="studio-tabs">
        {STUDIO_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`studio-tab-btn${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="studio-tab-icon" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'identity' && (
        <div className="studio-tab">
          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Agent identity</h2>
              <p className="studio-section-desc">
                How the agent introduces itself and represents your product on every call.
              </p>
            </div>
            <div className="studio-field-grid">
              <div className="studio-field">
                <label htmlFor="agentName">Agent name</label>
                <input
                  id="agentName"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Maya"
                />
              </div>
              <div className="studio-field">
                <label htmlFor="productName">Product name</label>
                <input
                  id="productName"
                  value={form.productName}
                  onChange={(e) => setForm({ ...form, productName: e.target.value })}
                  placeholder="e.g. Volkswagen India"
                />
                <p className="studio-field-hint">
                  Brand or catalog name used in soft-sell and redirects. For multi-model brands, use
                  the brand (e.g. Volkswagen India), not a single SKU like Virtus — otherwise the
                  agent locks onto that one model.
                </p>
              </div>
              <div className="studio-field studio-field--full">
                <label htmlFor="greeting">Greeting</label>
                <textarea
                  id="greeting"
                  rows={2}
                  value={form.greeting}
                  onChange={(e) => setForm({ ...form, greeting: e.target.value })}
                  placeholder="Spoken at the start of every call…"
                  style={{ minHeight: 'auto', fontFamily: 'inherit' }}
                />
                <p className="studio-field-hint">
                  First thing on connect. End with an open question so the caller speaks first (e.g.
                  features, pricing, demo).
                </p>
              </div>
              <div className="studio-field studio-field--full">
                <label htmlFor="persona">Persona</label>
                <input
                  id="persona"
                  value={form.persona}
                  onChange={(e) => setForm({ ...form, persona: e.target.value })}
                  placeholder="e.g. friendly and professional female sales agent"
                />
                <p className="studio-field-hint">
                  Shapes tone and style — kept in the system prompt alongside product knowledge.
                </p>
              </div>
            </div>
          </section>

          <div className="studio-callout studio-callout--active">
            <span className="studio-callout-icon" aria-hidden>👤</span>
            <div>
              <p className="studio-callout-label">Preview</p>
              <p className="studio-callout-value">
                {form.name} · {form.productName}
              </p>
              <p>&ldquo;{form.greeting}&rdquo;</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'voice' && (
        <div className="studio-tab">
          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Voice pipeline</h2>
              <p className="studio-section-desc">
                Gemini Live speech-to-speech — used by Simulator 2.0 and phone outbound. Tune
                model, voice, and language once, then Save.
              </p>
            </div>
            <div className="studio-field-grid">
              <div className="studio-field">
                <label htmlFor="voicePipeline">Pipeline</label>
                <select id="voicePipeline" value="gemini_live" disabled>
                  <option value="gemini_live">Gemini Live S2S</option>
                </select>
              </div>
            </div>
            <div className="studio-callout studio-callout--active sim-s2s-preset">
              <RealtimeS2sSettingsForm
                config={realtimeS2sConfig}
                onChange={(config) => {
                  setRealtimeS2sConfig(config);
                  setForm((f) => ({
                    ...f,
                    voicePipeline: 'gemini_live',
                    realtimeVoice: config.voice,
                  }));
                }}
                pipeline="gemini_live"
              />
            </div>
            <p className="studio-field-hint">
              Requires GEMINI_API_KEY (or GOOGLE_API_KEY) on agent-v2 and API for phone S2S. Set
              language hi-IN for Hindi/Hinglish. Voice accent is global HD — not pure desi.
            </p>
          </section>

          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Languages</h2>
              <p className="studio-section-desc">
                Agent listens in English and Hindi, and replies in the caller&apos;s language
                (including Hinglish).
              </p>
            </div>
            <div className="studio-chip-group">
              {SPEAK_LANG_OPTIONS.map(({ code, label, flag }) => (
                <label
                  key={code}
                  className={`studio-chip${speakLanguages.includes(code) ? ' selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={speakLanguages.includes(code)}
                    onChange={() => toggleSpeakLanguage(code)}
                  />
                  <span aria-hidden>{flag}</span> {label}
                </label>
              ))}
            </div>
          </section>

          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Voice & grammar</h2>
              <p className="studio-section-desc">
                Gemini Live voice is selected above. Grammar still controls Hindi/Hinglish verb
                forms.
              </p>
            </div>

            <p className="studio-section-desc" style={{ marginTop: '0.25rem' }}>
              Hindi / Hinglish grammar
            </p>
            <div className="studio-choice-grid">
              <button
                type="button"
                className={`studio-choice-card${form.agentGender === 'female' ? ' selected' : ''}`}
                onClick={() => setForm({ ...form, agentGender: 'female' })}
              >
                <strong>Female</strong>
                <span>karti hoon, bol rehi hoon</span>
              </button>
              <button
                type="button"
                className={`studio-choice-card${form.agentGender === 'male' ? ' selected' : ''}`}
                onClick={() => setForm({ ...form, agentGender: 'male' })}
              >
                <strong>Male</strong>
                <span>karta hoon, bol raha hoon</span>
              </button>
            </div>
          </section>

          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Delivery</h2>
              <p className="studio-section-desc">
                Speaking speed hint for the Gemini Live session (when supported by the model).
              </p>
            </div>
            <div className="studio-field-grid">
              <div className="studio-slider-card">
                <div className="studio-slider-head">
                  <label htmlFor="voiceSpeedRealtime">Speed</label>
                  <span className="studio-slider-value">{form.voiceSpeed.toFixed(1)}×</span>
                </div>
                <input
                  id="voiceSpeedRealtime"
                  type="range"
                  min={0.6}
                  max={1.5}
                  step={0.05}
                  value={form.voiceSpeed}
                  onChange={(e) => setForm({ ...form, voiceSpeed: Number(e.target.value) })}
                />
              </div>
            </div>
          </section>
        </div>
      )}

      {tab === 'brain' && (
        <div className="studio-tab">
          <BrainVisualization />

          <section className="studio-section" style={{ marginTop: '1.5rem' }}>
            <div className="studio-section-header">
              <h2 className="studio-section-title">Agent rules</h2>
              <p className="studio-section-desc">
                Short must-follow rules for this client (domain lock, "never quote X", escalation).
                Always in the call prompt — unlike Product knowledge, which is searched when large.
              </p>
            </div>
            <div className="studio-editor-panel">
              <div className="studio-editor-head">
                <label htmlFor="agentRules">Rules</label>
                <span className="studio-tag studio-tag--blue">
                  {form.agentRules.length}/{AGENT_RULES_MAX_CHARS}
                </span>
              </div>
              <textarea
                id="agentRules"
                maxLength={AGENT_RULES_MAX_CHARS}
                rows={6}
                placeholder={'- Only answer agriculture questions; politely decline anything else.\n- Never recommend a pesticide dose that is not in Product knowledge.'}
                value={form.agentRules}
                onChange={(e) => setForm({ ...form, agentRules: e.target.value })}
              />
              {ruleLikeBrainHeadings(form.brainMarkdown).length > 0 && (
                <p className="studio-field-hint">
                  These Brain sections look like rules — consider moving their key lines here:{' '}
                  {ruleLikeBrainHeadings(form.brainMarkdown).join(' · ')}
                </p>
              )}
            </div>
          </section>

          <section className="studio-section" style={{ marginTop: '1.5rem' }}>
            <div className="studio-section-header">
              <h2 className="studio-section-title">Product knowledge</h2>
              <p className="studio-section-desc">
                Full product docs in markdown. On save, the active LLM compresses this into a lean
                brief for calls — longer docs get longer summaries, but stay token-efficient.
              </p>
            </div>
            <div className="studio-brain-grid">
              <div className="studio-editor-panel">
                <div className="studio-editor-head">
                  <label htmlFor="brainMarkdown">Source document</label>
                  <span className="studio-tag studio-tag--blue">Editable</span>
                </div>
                <textarea
                  id="brainMarkdown"
                  value={form.brainMarkdown}
                  onChange={(e) => setForm({ ...form, brainMarkdown: e.target.value })}
                />
              </div>
              <div className="studio-editor-panel studio-editor-panel--readonly">
                <div className="studio-editor-head">
                  <label htmlFor="brainSummary">Compiled brief</label>
                  <span className="studio-tag studio-tag--green">Auto-generated</span>
                </div>
                <textarea
                  id="brainSummary"
                  className="brain-summary-readonly"
                  readOnly
                  value={
                    saving
                      ? 'Summarizing with active LLM…'
                      : brainSummary ||
                        'Save the agent to generate a summary from product knowledge.'
                  }
                />
                <p className="studio-field-hint">
                  Used in Simulator and live calls. Not editable — regenerate by saving.
                </p>
              </div>
            </div>

            <div className="studio-toggle-card" style={{ marginTop: '1rem' }}>
              <div>
                <strong>Allow LLM general knowledge</strong>
                <p>
                  ON: if Product Knowledge is missing (own product or competitors), fill from LLM
                  knowledge and recommend the best-fit offering for {form.productName} by caller need.
                  OFF: answer only from the prompt / Brain — no LLM fill outside it.
                </p>
              </div>
              <label className="studio-toggle">
                <input
                  type="checkbox"
                  checked={generalKnowledgeEnabled}
                  onChange={async (e) => {
                    const next = e.target.checked;
                    setGeneralKnowledgeEnabled(next);
                    if (!agentId) return;
                    try {
                      const saved = await updateAgent(agentId, {
                        ...form,
                        learningsEnabled,
                        generalKnowledgeEnabled: next,
                      });
                      setBrainSummary(saved.brainSummary ?? '');
                      setMessage(
                        next
                          ? 'General knowledge ON — Simulator/calls can fill gaps from LLM.'
                          : 'General knowledge OFF — Simulator/calls use prompt/Brain only.',
                      );
                    } catch {
                      setGeneralKnowledgeEnabled(!next);
                      setMessage('Failed to update general knowledge toggle.');
                    }
                  }}
                />
                <span className="studio-toggle-track" />
                <span className="studio-toggle-thumb" />
              </label>
            </div>
          </section>
        </div>
      )}

      {tab === 'playbook' && (
        <div className="studio-tab">
          <PlaybookPanel
            playbook={playbook}
            derived={!storedPlaybook}
            onChange={(next) => {
              setStoredPlaybook(next);
              setPlaybookCleared(false);
            }}
            onApplyTemplate={(templateId) => {
              const applied = applyPlaybookTemplate(templateId, skillsConfig.booking);
              setStoredPlaybook(applied.playbook);
              setPlaybookCleared(false);
              setSkillsConfig({ ...skillsConfig, booking: applied.booking });
              setMessage('Template applied — review, then Save agent.');
            }}
            onReset={() => {
              setStoredPlaybook(null);
              setPlaybookCleared(true);
            }}
          />
        </div>
      )}

      {tab === 'skills' && (
        <div className="studio-tab">
          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Built-in skills engine</h2>
              <p className="studio-section-desc">
                Core / sales behaviour product-independent hai (discover → features → quote on ask →
                close on intent). Sales tab mein{' '}
                <strong>Booking policy</strong> har agent ke liye alag set karo (CRM demo vs hotel
                stay). Baaki product facts Brain mein rakho. Save agent to apply.
              </p>
            </div>
            <SkillsEditor
              skills={skillsConfig}
              productName={form.productName}
              readOnly
              bookingReadOnly={false}
              onChange={setSkillsConfig}
            />
          </section>
        </div>
      )}

      {tab === 'calendar' && (
        <div className="studio-tab">
          <section className="studio-section">
            {!agentId ? (
              <div className="studio-empty">
                <div className="studio-empty-icon" aria-hidden>
                  📅
                </div>
                <p>Save an agent first, then set appointment calendar rules for that agent.</p>
              </div>
            ) : (
              <CalendarAvailabilityPanel agentId={agentId} />
            )}
          </section>
        </div>
      )}

      {tab === 'learnings' && (
        <div className="studio-tab">
          {!agentId ? (
            <div className="studio-empty">
              <div className="studio-empty-icon" aria-hidden>📚</div>
              <p>Save an agent first, then run calls in the Simulator to build learnings.</p>
            </div>
          ) : (
            <>
              <div className="studio-stats-row">
                <div className="studio-stat-card">
                  <p className="studio-stat-label">Vector index</p>
                  <p className="studio-stat-value">{vectorCount}</p>
                </div>
                <div className="studio-stat-card">
                  <p className="studio-stat-label">Held for review</p>
                  <p className="studio-stat-value">{pendingMutations.length}</p>
                </div>
                <div className="studio-stat-card">
                  <p className="studio-stat-label">Prospect memories</p>
                  <p className="studio-stat-value">{prospects.length}</p>
                </div>
              </div>

              <div className="studio-toggle-card">
                <div>
                  <strong>Auto-learn from calls</strong>
                  <p>
                    Safe learnings are auto-applied. Competitor, pricing, and gap items are held
                    for your review.
                  </p>
                </div>
                <label className="studio-toggle">
                  <input
                    type="checkbox"
                    checked={learningsEnabled}
                    onChange={async (e) => {
                      const next = e.target.checked;
                      setLearningsEnabled(next);
                      try {
                        await updateAgent(agentId, { learningsEnabled: next });
                      } catch {
                        setLearningsEnabled(!next);
                        setMessage('Failed to update learnings toggle.');
                      }
                    }}
                  />
                  <span className="studio-toggle-track" />
                  <span className="studio-toggle-thumb" />
                </label>
              </div>

              <div className="studio-toolbar-actions" style={{ marginBottom: '0.5rem' }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={loadLearnings}
                  disabled={learningsLoading}
                >
                  {learningsLoading ? 'Loading…' : '↻ Refresh'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={async () => {
                    if (!confirm('Clear all global learnings?')) return;
                    await clearBrainLearnings(agentId);
                    await loadLearnings();
                  }}
                >
                  Clear learnings
                </button>
              </div>

              <section className="studio-panel">
                <div className="studio-panel-head">
                  <label>Global learnings archive</label>
                  <span className="studio-tag studio-tag--blue">{vectorCount} vectors</span>
                </div>
                <textarea
                  className="brain-summary-readonly"
                  readOnly
                  rows={6}
                  value={
                    brainLearnings ||
                    'No global learnings yet — complete a call to auto-learn.'
                  }
                />
                <p className="studio-field-hint">
                  Archive shows all saved lines. At call time only the best-matching items are
                  injected via vector retrieval.
                </p>
              </section>

              <section className="studio-panel">
                <div className="studio-panel-head">
                  <label>Held for review</label>
                  <span className="studio-tag studio-tag--orange">{pendingMutations.length}</span>
                </div>
                {pendingMutations.length === 0 ? (
                  <p className="studio-field-hint" style={{ margin: 0 }}>
                    Nothing held — safe items were auto-applied.
                  </p>
                ) : (
                  <ul className="studio-mutation-list">
                    {pendingMutations.map((m) => (
                      <li key={m.id} className="studio-mutation-item">
                        <span className={`mutation-kind mutation-status-${m.status}`}>
                          {m.kind}
                        </span>
                        <p>{m.content}</p>
                        <div className="studio-mutation-actions">
                          <button
                            type="button"
                            onClick={async () => {
                              await approveMutation(agentId, m.id);
                              await loadLearnings();
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={async () => {
                              await rejectMutation(agentId, m.id);
                              await loadLearnings();
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="studio-panel">
                <div className="studio-panel-head">
                  <label>Audit log</label>
                  <span className="studio-tag studio-tag--gray">{auditLog.length} entries</span>
                </div>
                {auditLog.length === 0 ? (
                  <p className="studio-field-hint" style={{ margin: 0 }}>
                    No calls processed yet.
                  </p>
                ) : (
                  <ul className="studio-mutation-list">
                    {auditLog.map((m) => (
                      <li key={m.id} className="studio-mutation-item">
                        <span className={`mutation-kind mutation-status-${m.status}`}>
                          {m.status.replace(/_/g, ' ')}
                        </span>
                        {m.kind !== 'call' && <span className="muted"> · {m.kind}</span>}
                        <p>{m.content}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="studio-panel">
                <div className="studio-panel-head">
                  <label>Prospect memories</label>
                  <span className="studio-tag studio-tag--green">{prospects.length}</span>
                </div>
                {prospects.length === 0 ? (
                  <p className="studio-field-hint" style={{ margin: 0 }}>
                    Use a prospect name in outbound Simulator calls to build memory.
                  </p>
                ) : (
                  <ul className="studio-mutation-list">
                    {prospects.map((p) => (
                      <li key={p.id} className="studio-mutation-item">
                        <span className="studio-prospect-name">
                          {p.displayName ?? p.prospectKey}
                        </span>
                        {p.callerStyle && (
                          <span className="muted"> · tone: {p.callerStyle}</span>
                        )}
                        <pre className="prospect-facts">{p.factsMarkdown || '—'}</pre>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {tab === 'llm' && (
        <div className="studio-tab">
          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">OpenAI GPT</h2>
              <p className="studio-section-desc">
                Brain summarization and product-knowledge compression use OpenAI GPT
                (not the live voice pipeline — that is Gemini Live).
              </p>
            </div>
          </section>

          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Model</h2>
              <p className="studio-section-desc">
                Select the GPT model compiled into this agent on save.
              </p>
            </div>

            <div className="llm-model-grid">
              {gptModelOptions.map((option) => {
                const selected = form.llmModel === option.value;
                const tagTone =
                  'tagTone' in option ? option.tagTone : ('gray' as const);
                const tag = 'tag' in option ? option.tag : undefined;
                return (
                  <label
                    key={option.value}
                    className={`llm-model-card${selected ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="gptModel"
                      value={option.value}
                      checked={selected}
                      onChange={() =>
                        setForm({ ...form, llmProvider: 'gpt', llmModel: option.value })
                      }
                      className="llm-model-input"
                    />
                    <div className="llm-model-card-body">
                      <div className="llm-model-card-head">
                        <strong>{option.label}</strong>
                        {tag ? (
                          <span className={`llm-tag llm-tag--${tagTone}`}>{tag}</span>
                        ) : null}
                      </div>
                      {'hint' in option && option.hint ? (
                        <p>{option.hint}</p>
                      ) : null}
                      <code className="llm-model-id">{option.value}</code>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <div className="studio-callout studio-callout--active">
            <span className="studio-callout-icon" aria-hidden>
              🧠
            </span>
            <div>
              <p className="studio-callout-label">Active configuration</p>
              <p className="studio-callout-value">
                OpenAI GPT · {form.llmModel}
              </p>
            </div>
          </div>

          <div className="studio-callout studio-callout--info">
            <span className="studio-callout-icon" aria-hidden>
              🔑
            </span>
            <div>
              <p className="studio-callout-label">API keys (agent worker)</p>
              <ul className="llm-callout-list">
                <li>
                  <code>OPENAI_API_KEY</code> — required for GPT brain summarization
                </li>
              </ul>
              <p className="llm-callout-footnote">Save the agent after changing model.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
