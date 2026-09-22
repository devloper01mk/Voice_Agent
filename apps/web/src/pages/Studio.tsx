import {
  DEFAULT_SKILLS,
  DEFAULT_GOOGLE_STT_MODEL,
  DEFAULT_OPENAI_STT_MODEL,
  DEFAULT_REALTIME_VOICE,
  DEFAULT_VOICE_PIPELINE,
  GOOGLE_STT_MODEL_OPTIONS,
  OPENAI_STT_MODEL_OPTIONS,
  SARVAM_STT_MODEL_OPTIONS,
  defaultGeminiLiveS2sUserConfig,
  defaultRealtimeS2sUserConfig,
  defaultSttModel,
  isS2sPipeline,
  mergeSkillsConfig,
  normalizeRealtimeS2sUserConfig,
  normalizeSttProvider,
  normalizeVoicePipeline,
  resolveGeminiLiveVoice,
  resolveRealtimeVoice,
  resolveSttModel,
  type RealtimeS2sUserConfig,
  type SkillsConfig,
  type SttProvider,
  type VoicePipeline,
} from '@vsa/shared';
import { useEffect, useMemo, useState } from 'react';
import RealtimeS2sSettingsForm from '../components/RealtimeS2sSettingsForm';
import { BrainVisualization } from '../components/studio/BrainVisualization';
import CalendarAvailabilityPanel from '../components/studio/CalendarAvailabilityPanel';
import { SkillsEditor } from '../components/studio/SkillsEditor';
import {
  type Agent,
  type BrainMutation,
  type CartesiaVoice,
  type ProspectMemory,
  type TtsEmotion,
  type TtsModel,
  type TtsSampleRate,
  approveMutation,
  clearBrainLearnings,
  createAgent,
  getAgent,
  getGlobalLearningStats,
  listAgents,
  listLearningAudit,
  listPendingMutations,
  listProspectMemories,
  listTtsEmotions,
  listTtsModels,
  listTtsSampleRates,
  listTtsVoices,
  previewTts,
  rejectMutation,
  updateAgent,
} from '../api';

const DEFAULT_VOICE =
  import.meta.env.VITE_CARTESIA_VOICE_ID ?? '95d51f79-c397-46f9-b49a-23763d3eaa2d';

const PREVIEW_SAMPLES = {
  en: "Hi, I'm your Cronberry sales assistant. This is how I'll sound on a call.",
  hi: 'नमस्ते, मैं क्रॉनबेरी से माया बोल रही हूँ। क्या आप सेल्स पाइपलाइन के बारे में जानना चाहेंगे?',
  hinglish:
    "Hi, main Maya bol rehi hoon Cronberry se. Aap apni sales pipeline manage karna chahte hain?",
};

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

function voiceGenderToAgent(gender: string): 'female' | 'male' {
  return /feminine|female/i.test(gender) ? 'female' : 'male';
}

type Tab = 'identity' | 'voice' | 'brain' | 'skills' | 'calendar' | 'learnings' | 'llm' | 'stt';

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
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

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

const LLM_PROVIDERS = [
  {
    id: 'groq' as const,
    label: 'Groq',
    badge: 'Ultra fast',
    badgeTone: 'green' as const,
    description: 'Optimized for real-time voice — minimal time-to-first-token on calls.',
    icon: '⚡',
    model: DEFAULT_GROQ_MODEL,
    apiEnv: 'GROQ_API_KEY',
  },
  {
    id: 'gpt' as const,
    label: 'OpenAI GPT',
    badge: 'Best quality',
    badgeTone: 'blue' as const,
    description: 'Stronger reasoning for complex objections, pricing, and product Q&A.',
    icon: '✨',
    apiEnv: 'OPENAI_API_KEY',
  },
] as const;

const STT_PROVIDERS = [
  {
    id: 'azure' as const,
    label: 'Azure Speech',
    badge: 'Default',
    badgeTone: 'green' as const,
    description:
      'Current production STT — multilingual en/hi, phrase boosting, and email-capture tuning.',
    icon: '🎙️',
    apiEnv: 'AZURE_SPEECH_KEY',
  },
  {
    id: 'sarvam' as const,
    label: 'Sarvam Saaras',
    badge: 'Indian STT',
    badgeTone: 'blue' as const,
    description:
      'Saaras v3/v4 — 22 Indian languages, Hinglish code-mix, noisy phone calls (SARVAM_API_KEY).',
    icon: '🇮🇳',
    apiEnv: 'SARVAM_API_KEY',
  },
  {
    id: 'google' as const,
    label: 'Google Cloud STT',
    badge: 'Chirp',
    badgeTone: 'blue' as const,
    description:
      'Chirp 2/3 via Speech v2 — multilingual en/hi on asia-south1 (GOOGLE_APPLICATION_CREDENTIALS).',
    icon: '☁️',
    apiEnv: 'GOOGLE_APPLICATION_CREDENTIALS',
  },
  {
    id: 'openai' as const,
    label: 'OpenAI STT',
    badge: 'Simulator',
    badgeTone: 'gray' as const,
    description:
      'OpenAI realtime transcription for Simulator 2.0 cascaded calls (OPENAI_API_KEY). Phone uses Azure unless Sarvam is selected.',
    icon: '🌐',
    apiEnv: 'OPENAI_API_KEY',
  },
] as const;

const STUDIO_TABS = [
  { id: 'identity' as Tab, label: 'Identity', icon: '👤' },
  { id: 'voice' as Tab, label: 'Voice', icon: '🎤' },
  { id: 'brain' as Tab, label: 'Brain', icon: '🧠' },
  { id: 'skills' as Tab, label: 'Skills', icon: '📋' },
  { id: 'calendar' as Tab, label: 'Calendar', icon: '📅' },
  { id: 'learnings' as Tab, label: 'Learnings', icon: '📚' },
  { id: 'llm' as Tab, label: 'LLM', icon: '✨' },
  { id: 'stt' as Tab, label: 'STT', icon: '🎧' },
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
  voiceId: DEFAULT_VOICE,
  voiceLanguage: 'en',
  voiceLanguages: 'en,hi,hinglish',
  voiceSpeed: 1,
  voicePitch: 1,
  ttsModel: 'sonic-3.6',
  ttsSampleRate: 24000,
  ttsEmotion: '',
  voicePipeline: DEFAULT_VOICE_PIPELINE as VoicePipeline,
  realtimeVoice: DEFAULT_REALTIME_VOICE,
  agentGender: 'female' as 'female' | 'male',
  llmProvider: 'gpt' as 'groq' | 'gpt',
  llmModel: DEFAULT_GPT_MODEL,
  sttProvider: 'azure' as SttProvider,
  sttModel: '',
  brainMarkdown: DEFAULT_BRAIN,
});

export default function StudioPage() {
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [tab, setTab] = useState<Tab>('identity');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [previewing, setPreviewing] = useState(false);

  const [previewLang, setPreviewLang] = useState<SpeakLang>('hinglish');
  const [ttsModels, setTtsModels] = useState<TtsModel[]>([]);
  const [ttsSampleRates, setTtsSampleRates] = useState<TtsSampleRate[]>([]);
  const [ttsEmotions, setTtsEmotions] = useState<TtsEmotion[]>([]);
  const [voices, setVoices] = useState<CartesiaVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);

  const [form, setForm] = useState(defaultForm());
  const [realtimeS2sConfig, setRealtimeS2sConfig] = useState<RealtimeS2sUserConfig>(
    defaultRealtimeS2sUserConfig(),
  );
  const [brainSummary, setBrainSummary] = useState('');
  const [brainLearnings, setBrainLearnings] = useState('');
  const [skillsConfig, setSkillsConfig] = useState<SkillsConfig>(DEFAULT_SKILLS);
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
          voiceId: a.voiceId,
          voiceLanguage: a.voiceLanguage ?? 'en',
          voiceLanguages: a.voiceLanguages ?? 'en,hi,hinglish',
          voiceSpeed: a.voiceSpeed,
          voicePitch: a.voicePitch ?? 1,
          ttsModel: a.ttsModel ?? 'sonic-3.6',
          ttsSampleRate: a.ttsSampleRate ?? 24000,
          ttsEmotion: a.ttsEmotion ?? '',
          voicePipeline: normalizeVoicePipeline(a.voicePipeline),
          realtimeVoice:
            normalizeVoicePipeline(a.voicePipeline) === 'gemini_live'
              ? resolveGeminiLiveVoice(a.realtimeVoice)
              : resolveRealtimeVoice(a.realtimeVoice),
          agentGender: a.agentGender === 'male' ? 'male' : 'female',
          llmProvider: a.llmProvider,
          llmModel: a.llmModel,
          sttProvider: normalizeSttProvider(a.sttProvider),
          sttModel: resolveSttModel(
            normalizeSttProvider(a.sttProvider),
            a.sttModel,
          ),
          brainMarkdown: a.brainMarkdown,
        });
        const pipeline = normalizeVoicePipeline(a.voicePipeline);
        setRealtimeS2sConfig(
          normalizeRealtimeS2sUserConfig(
            {
              ...(a.realtimeS2sConfig ?? {}),
              voice:
                pipeline === 'gemini_live'
                  ? resolveGeminiLiveVoice(a.realtimeS2sConfig?.voice ?? a.realtimeVoice)
                  : resolveRealtimeVoice(a.realtimeS2sConfig?.voice ?? a.realtimeVoice),
            },
            pipeline,
          ),
        );
        setBrainSummary(a.brainSummary ?? '');
        setBrainLearnings(a.brainLearnings ?? '');
        setLearningsEnabled(a.learningsEnabled !== false);
        setGeneralKnowledgeEnabled(a.generalKnowledgeEnabled !== false);
        setSkillsConfig(normalizeSkillsConfig(a.skillsConfig));
      })
      .catch(() => setMessage('Failed to load agent'));
  }, [agentId]);

  useEffect(() => {
    if (tab !== 'voice') return;
    setVoicesLoading(true);

    Promise.all([
      listTtsModels(),
      listTtsSampleRates(),
      listTtsEmotions(),
      listTtsVoices(),
    ])
      .then(([models, rates, emotions, list]) => {
        setTtsModels(models);
        setTtsSampleRates(rates);
        setTtsEmotions(emotions);
        setVoices(list);
        if (list.length && !list.some((v) => v.id === form.voiceId)) {
          setForm((f) => ({ ...f, voiceId: list[0]!.id }));
        }
      })
      .catch(() => setMessage('Failed to load TTS settings — check CARTESIA_API_KEY.'))
      .finally(() => setVoicesLoading(false));
  }, [tab]);

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

  useEffect(() => {
    if (!speakLanguages.includes(previewLang) && speakLanguages[0]) {
      setPreviewLang(speakLanguages[0]);
    }
  }, [speakLanguages, previewLang]);

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
        });
        setAgentId(saved.id);
        const list = await listAgents();
        setAgents(list);
      }
      setMessage(
        `Saved. Brain summarized with ${form.llmProvider === 'groq' ? 'Groq' : 'GPT'}. Prompt ~${saved.promptTokenCount ?? '?'} tokens.`,
      );
      setBrainSummary(saved.brainSummary ?? '');
      setBrainLearnings(saved.brainLearnings ?? '');
      setGeneralKnowledgeEnabled(saved.generalKnowledgeEnabled !== false);
      setSkillsConfig(normalizeSkillsConfig(saved.skillsConfig));
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

  const playPreview = async () => {
    setPreviewing(true);
    setMessage('');
    try {
      const blob = await previewTts(
        PREVIEW_SAMPLES[previewLang],
        form.voiceId,
        form.voiceSpeed,
        form.voicePitch,
        form.voiceLanguages,
        form.ttsModel,
        form.ttsSampleRate,
        form.ttsEmotion,
      );
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play();
    } catch {
      setMessage('TTS preview failed — set CARTESIA_API_KEY on API.');
    } finally {
      setPreviewing(false);
    }
  };

  const onLlmProviderChange = (provider: 'groq' | 'gpt') => {
    setForm((f) => ({
      ...f,
      llmProvider: provider,
      llmModel: provider === 'gpt' ? DEFAULT_GPT_MODEL : DEFAULT_GROQ_MODEL,
    }));
  };

  const onSttProviderChange = (provider: SttProvider) => {
    setForm((f) => ({
      ...f,
      sttProvider: provider,
      sttModel: defaultSttModel(provider),
    }));
  };

  const gptModelOptions = useMemo(() => {
    const known = GPT_MODEL_OPTIONS.some((option) => option.value === form.llmModel);
    if (known || form.llmProvider !== 'gpt') return GPT_MODEL_OPTIONS;
    return [
      ...GPT_MODEL_OPTIONS,
      { value: form.llmModel, label: `${form.llmModel} (saved)` },
    ];
  }, [form.llmModel, form.llmProvider]);

  const openaiSttModelOptions = useMemo(() => {
    const known = OPENAI_STT_MODEL_OPTIONS.some((option) => option.value === form.sttModel);
    if (known || form.sttProvider !== 'openai') return [...OPENAI_STT_MODEL_OPTIONS];
    return [
      ...OPENAI_STT_MODEL_OPTIONS,
      {
        value: form.sttModel,
        label: `${form.sttModel} (saved)`,
        hint: 'Saved custom model',
        tag: 'Custom' as const,
        tagTone: 'gray' as const,
      },
    ];
  }, [form.sttModel, form.sttProvider]);

  const sarvamSttModelOptions = useMemo(() => {
    const known = SARVAM_STT_MODEL_OPTIONS.some((option) => option.value === form.sttModel);
    if (known || form.sttProvider !== 'sarvam') return [...SARVAM_STT_MODEL_OPTIONS];
    return [
      ...SARVAM_STT_MODEL_OPTIONS,
      {
        value: form.sttModel,
        label: `${form.sttModel} (saved)`,
        hint: 'Saved custom model',
        tag: 'Custom' as const,
        tagTone: 'gray' as const,
      },
    ];
  }, [form.sttModel, form.sttProvider]);

  const googleSttModelOptions = useMemo(() => {
    const known = GOOGLE_STT_MODEL_OPTIONS.some((option) => option.value === form.sttModel);
    if (known || form.sttProvider !== 'google') return [...GOOGLE_STT_MODEL_OPTIONS];
    return [
      ...GOOGLE_STT_MODEL_OPTIONS,
      {
        value: form.sttModel,
        label: `${form.sttModel} (saved)`,
        hint: 'Saved custom model',
        tag: 'Custom' as const,
        tagTone: 'gray' as const,
      },
    ];
  }, [form.sttModel, form.sttProvider]);

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

  const selectedVoice = voices.find((v) => v.id === form.voiceId);

  return (
    <div className="card studio-page">
      <h1 className="page-title">
        <span className="page-icon" aria-hidden>🎙️</span>
        Agent Studio
      </h1>
      <p className="page-subtitle">
        Configure your voice agent — identity, voice, product knowledge, skills, LLM, and STT settings.
        Everything compiles when you save.
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
                Fixed per agent — Simulator 2.0 and phone outbound use this setting. Choose Cascaded,
                OpenAI Realtime S2S, or Gemini Live S2S, tune model/voice/language once, then Save.
              </p>
            </div>
            <div className="studio-field-grid">
              <div className="studio-field">
                <label htmlFor="voicePipeline">Pipeline</label>
                <select
                  id="voicePipeline"
                  value={form.voicePipeline}
                  onChange={(e) => {
                    const voicePipeline = normalizeVoicePipeline(e.target.value);
                    setForm({ ...form, voicePipeline });
                    setRealtimeS2sConfig(
                      voicePipeline === 'gemini_live'
                        ? defaultGeminiLiveS2sUserConfig()
                        : voicePipeline === 'openai_realtime'
                          ? defaultRealtimeS2sUserConfig()
                          : realtimeS2sConfig,
                    );
                  }}
                >
                  <option value="cascaded">Cascaded (Azure STT + GPT + Cartesia)</option>
                  <option value="openai_realtime">OpenAI Realtime S2S</option>
                  <option value="gemini_live">Gemini Live S2S</option>
                </select>
              </div>
            </div>
            {isS2sPipeline(form.voicePipeline) && (
              <div className="studio-callout studio-callout--active sim-s2s-preset">
                <RealtimeS2sSettingsForm
                  config={realtimeS2sConfig}
                  onChange={(config) => {
                    setRealtimeS2sConfig(config);
                    setForm((f) => ({ ...f, realtimeVoice: config.voice }));
                  }}
                  pipeline={form.voicePipeline}
                />
              </div>
            )}
            {form.voicePipeline === 'openai_realtime' && (
              <p className="studio-field-hint">
                Requires OPENAI_API_KEY on agent-v2. No Azure STT or Cartesia on the live call.
              </p>
            )}
            {form.voicePipeline === 'gemini_live' && (
              <p className="studio-field-hint">
                Requires GEMINI_API_KEY (or GOOGLE_API_KEY) on agent-v2 and API for phone S2S.
                Set language hi-IN for Hindi/Hinglish. Voice accent is global HD — not pure desi.
              </p>
            )}
          </section>

          {form.voicePipeline === 'cascaded' && (
          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Speech engine</h2>
              <p className="studio-section-desc">
                Cartesia Sonic powers preview and live calls. Settings are saved with the agent.
              </p>
            </div>
            <div className="studio-field-grid">
              <div className="studio-field">
                <label htmlFor="ttsModel">TTS model</label>
                <select
                  id="ttsModel"
                  value={form.ttsModel}
                  onChange={(e) => setForm({ ...form, ttsModel: e.target.value })}
                >
                  {ttsModels.length === 0 && (
                    <option value={form.ttsModel}>{form.ttsModel}</option>
                  )}
                  {ttsModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="studio-field">
                <label htmlFor="ttsSampleRate">Sample rate</label>
                <select
                  id="ttsSampleRate"
                  value={form.ttsSampleRate}
                  onChange={(e) =>
                    setForm({ ...form, ttsSampleRate: Number(e.target.value) })
                  }
                >
                  {ttsSampleRates.length === 0 && (
                    <option value={form.ttsSampleRate}>{form.ttsSampleRate} Hz</option>
                  )}
                  {ttsSampleRates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
          )}

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
                {form.voicePipeline === 'openai_realtime'
                  ? 'OpenAI Realtime voice is selected above. Grammar still controls Hindi/Hinglish verb forms.'
                  : form.voicePipeline === 'gemini_live'
                    ? 'Gemini Live voice is selected above. Grammar still controls Hindi/Hinglish verb forms.'
                    : 'Indian female Cartesia voices (Hindi / Hinglish). Grammar still controls Hindi/Hinglish verb forms.'}
              </p>
            </div>
            {form.voicePipeline === 'cascaded' && (
            <div className="studio-field-grid">
              <div className="studio-field studio-field--full">
                <label htmlFor="voiceId">Indian female voice (Cartesia)</label>
                <select
                  id="voiceId"
                  value={form.voiceId}
                  disabled={voicesLoading || voices.length === 0}
                  onChange={(e) => {
                    const voiceId = e.target.value;
                    const voice = voices.find((v) => v.id === voiceId);
                    setForm((f) => ({
                      ...f,
                      voiceId,
                      agentGender: voice ? voiceGenderToAgent(voice.gender) : f.agentGender,
                    }));
                  }}
                >
                  {voicesLoading && <option value={form.voiceId}>Loading voices…</option>}
                  {!voicesLoading && voices.length === 0 && (
                    <option value={form.voiceId}>No Indian female voices found</option>
                  )}
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.language}/{v.gender})
                    </option>
                  ))}
                </select>
                {selectedVoice?.description && (
                  <p className="studio-field-hint">{selectedVoice.description}</p>
                )}
              </div>
            </div>
            )}

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

          {form.voicePipeline === 'cascaded' ? (
          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Delivery</h2>
              <p className="studio-section-desc">
                Cartesia generation controls: speed, volume, and emotion (Sonic 3+).
              </p>
            </div>
            <div className="studio-field-grid">
              <div className="studio-slider-card">
                <div className="studio-slider-head">
                  <label htmlFor="voiceSpeed">Speed</label>
                  <span className="studio-slider-value">{form.voiceSpeed.toFixed(1)}×</span>
                </div>
                <input
                  id="voiceSpeed"
                  type="range"
                  min={0.6}
                  max={1.5}
                  step={0.05}
                  value={form.voiceSpeed}
                  onChange={(e) => setForm({ ...form, voiceSpeed: Number(e.target.value) })}
                />
              </div>
              <div className="studio-slider-card">
                <div className="studio-slider-head">
                  <label htmlFor="voicePitch">Volume</label>
                  <span className="studio-slider-value">{form.voicePitch.toFixed(1)}</span>
                </div>
                <input
                  id="voicePitch"
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={form.voicePitch}
                  onChange={(e) => setForm({ ...form, voicePitch: Number(e.target.value) })}
                />
              </div>
              <div className="studio-field studio-field--full">
                <label htmlFor="ttsEmotion">Emotion</label>
                <select
                  id="ttsEmotion"
                  value={form.ttsEmotion}
                  onChange={(e) => setForm({ ...form, ttsEmotion: e.target.value })}
                >
                  {ttsEmotions.length === 0 && (
                    <option value={form.ttsEmotion}>
                      {form.ttsEmotion || 'Neutral (auto from transcript)'}
                    </option>
                  )}
                  {ttsEmotions.map((e) => (
                    <option key={e.id || 'auto'} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
                <p className="studio-field-hint">
                  Simulator 2.0 live calls: empty / Neutral defaults to Cartesia{' '}
                  <strong>happy</strong> (lightly expressive / positive mood). Classic
                  simulator still uses the saved value as-is.
                </p>
              </div>
            </div>
          </section>
          ) : (
          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Delivery</h2>
              <p className="studio-section-desc">
                OpenAI Realtime speaking speed (applied to the S2S session).
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
          )}

          {form.voicePipeline === 'cascaded' && (
          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Preview</h2>
              <p className="studio-section-desc">Hear how the agent sounds before going live.</p>
            </div>
            <div className="studio-preview-bar">
              <div className="studio-field">
                <label htmlFor="previewLang">Preview language</label>
                <select
                  id="previewLang"
                  value={previewLang}
                  onChange={(e) => setPreviewLang(e.target.value as SpeakLang)}
                >
                  {speakLanguages.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang === 'en' ? 'English' : lang === 'hi' ? 'Hindi' : 'Hinglish'}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" onClick={playPreview} disabled={previewing || !form.voiceId}>
                {previewing ? '▶ Playing…' : '▶ Preview TTS'}
              </button>
            </div>
          </section>
          )}
        </div>
      )}

      {tab === 'brain' && (
        <div className="studio-tab">
          <BrainVisualization />

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
              <h2 className="studio-section-title">Inference provider</h2>
              <p className="studio-section-desc">
                Pick the engine that powers this agent&apos;s replies during live calls.
              </p>
            </div>

            <div className="llm-provider-grid">
              {LLM_PROVIDERS.map((provider) => {
                const selected = form.llmProvider === provider.id;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    className={`llm-provider-card${selected ? ' selected' : ''}`}
                    onClick={() => onLlmProviderChange(provider.id)}
                    aria-pressed={selected}
                  >
                    <span className="llm-provider-icon" aria-hidden>
                      {provider.icon}
                    </span>
                    <div className="llm-provider-body">
                      <div className="llm-provider-head">
                        <strong>{provider.label}</strong>
                        <span className={`llm-tag llm-tag--${provider.badgeTone}`}>
                          {provider.badge}
                        </span>
                      </div>
                      <p>{provider.description}</p>
                      {provider.id === 'groq' && (
                        <span className="llm-provider-model">{provider.model}</span>
                      )}
                    </div>
                    {selected && <span className="llm-provider-check" aria-hidden>✓</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Model</h2>
              <p className="studio-section-desc">
                {form.llmProvider === 'gpt'
                  ? 'Select the GPT model compiled into this agent on save.'
                  : 'Groq uses a fixed high-speed model for consistent call latency.'}
              </p>
            </div>

            {form.llmProvider === 'gpt' ? (
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
                        onChange={() => setForm({ ...form, llmModel: option.value })}
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
            ) : (
              <div className="llm-groq-model-card">
                <div className="llm-groq-model-icon" aria-hidden>
                  🚀
                </div>
                <div>
                  <div className="llm-model-card-head">
                    <strong>Llama 3.3 70B Versatile</strong>
                    <span className="llm-tag llm-tag--green">Default</span>
                  </div>
                  <p>Balanced speed and quality on Groq&apos;s inference stack.</p>
                  <code className="llm-model-id">{DEFAULT_GROQ_MODEL}</code>
                </div>
              </div>
            )}
          </section>

          <div className="studio-callout studio-callout--active">
            <span className="studio-callout-icon" aria-hidden>
              🧠
            </span>
            <div>
              <p className="studio-callout-label">Active configuration</p>
              <p className="studio-callout-value">
                {form.llmProvider === 'gpt' ? 'OpenAI GPT' : 'Groq'} · {form.llmModel}
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
                  <code>GROQ_API_KEY</code> — required for Groq provider
                </li>
                <li>
                  <code>OPENAI_API_KEY</code> — required for GPT provider
                </li>
              </ul>
              <p className="llm-callout-footnote">Save the agent after changing provider or model.</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'stt' && (
        <div className="studio-tab">
          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Speech-to-text provider</h2>
              <p className="studio-section-desc">
                Choose how this agent listens during live calls. Azure remains the default.
              </p>
            </div>

            <div className="llm-provider-grid">
              {STT_PROVIDERS.map((provider) => {
                const selected = form.sttProvider === provider.id;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    className={`llm-provider-card${selected ? ' selected' : ''}`}
                    onClick={() => onSttProviderChange(provider.id)}
                    aria-pressed={selected}
                  >
                    <span className="llm-provider-icon" aria-hidden>
                      {provider.icon}
                    </span>
                    <div className="llm-provider-body">
                      <div className="llm-provider-head">
                        <strong>{provider.label}</strong>
                        <span className={`llm-tag llm-tag--${provider.badgeTone}`}>
                          {provider.badge}
                        </span>
                      </div>
                      <p>{provider.description}</p>
                    </div>
                    {selected && <span className="llm-provider-check" aria-hidden>✓</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="studio-section">
            <div className="studio-section-header">
              <h2 className="studio-section-title">Model</h2>
              <p className="studio-section-desc">
                {form.sttProvider === 'openai'
                  ? 'Select the OpenAI transcription model used for Simulator 2.0 cascaded calls.'
                  : form.sttProvider === 'sarvam'
                    ? 'Select Saaras model. Hinglish agents auto-use codemix mode on phone and simulator.'
                    : form.sttProvider === 'google'
                      ? 'Select Chirp / telephony model. Languages follow the Voice tab (en-IN + hi-IN).'
                    : 'Azure Speech uses the regional Speech service — no separate model id is required.'}
              </p>
            </div>

            {form.sttProvider === 'openai' ? (
              <div className="llm-model-grid">
                {openaiSttModelOptions.map((option) => {
                  const selected = form.sttModel === option.value;
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
                        name="openaiSttModel"
                        value={option.value}
                        checked={selected}
                        onChange={() =>
                          setForm({
                            ...form,
                            sttModel: option.value || DEFAULT_OPENAI_STT_MODEL,
                          })
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
                        {'hint' in option && option.hint ? <p>{option.hint}</p> : null}
                        <code className="llm-model-id">{option.value}</code>
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : form.sttProvider === 'sarvam' ? (
              <div className="llm-model-grid">
                {sarvamSttModelOptions.map((option) => {
                  const selected = form.sttModel === option.value;
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
                        name="sarvamSttModel"
                        value={option.value}
                        checked={selected}
                        onChange={() =>
                          setForm({
                            ...form,
                            sttModel: option.value,
                          })
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
                        {'hint' in option && option.hint ? <p>{option.hint}</p> : null}
                        <code className="llm-model-id">{option.value}</code>
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : form.sttProvider === 'google' ? (
              <div className="llm-model-grid">
                {googleSttModelOptions.map((option) => {
                  const selected = form.sttModel === option.value;
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
                        name="googleSttModel"
                        value={option.value}
                        checked={selected}
                        onChange={() =>
                          setForm({
                            ...form,
                            sttModel: option.value,
                          })
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
                        {'hint' in option && option.hint ? <p>{option.hint}</p> : null}
                        <code className="llm-model-id">{option.value}</code>
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="llm-groq-model-card">
                <div className="llm-groq-model-icon" aria-hidden>
                  🎧
                </div>
                <div>
                  <div className="llm-model-card-head">
                    <strong>Azure Speech (multilingual)</strong>
                    <span className="llm-tag llm-tag--green">Default</span>
                  </div>
                  <p>
                    Keeps phrase boosting, confidence filtering, and email-capture STT
                    relaxation. Languages follow the Voice tab selection.
                  </p>
                  <code className="llm-model-id">azure-speech</code>
                </div>
              </div>
            )}
          </section>

          <div className="studio-callout studio-callout--active">
            <span className="studio-callout-icon" aria-hidden>
              🎧
            </span>
            <div>
              <p className="studio-callout-label">Active configuration</p>
              <p className="studio-callout-value">
                {form.sttProvider === 'openai'
                  ? 'OpenAI STT'
                  : form.sttProvider === 'sarvam'
                    ? 'Sarvam Saaras'
                    : form.sttProvider === 'google'
                      ? 'Google Cloud STT'
                    : 'Azure Speech'}
                {form.sttProvider === 'openai' || form.sttProvider === 'sarvam' || form.sttProvider === 'google'
                  ? ` · ${form.sttModel || resolveSttModel(form.sttProvider, form.sttModel)}`
                  : ''}
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
                  <code>AZURE_SPEECH_KEY</code> / <code>AZURE_SPEECH_REGION</code> — Azure STT
                </li>
                <li>
                  <code>SARVAM_API_KEY</code> — Sarvam Saaras STT (phone + simulator)
                </li>
                <li>
                  <code>GOOGLE_CLOUD_PROJECT</code> / <code>GOOGLE_APPLICATION_CREDENTIALS</code> — Google STT (phone + simulator)
                </li>
                <li>
                  <code>OPENAI_API_KEY</code> — OpenAI STT (Simulator 2.0 cascaded)
                </li>
              </ul>
              <p className="llm-callout-footnote">
                Sarvam uses codemix mode automatically when Voice tab includes Hinglish. Save the
                agent after changing provider or model.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
