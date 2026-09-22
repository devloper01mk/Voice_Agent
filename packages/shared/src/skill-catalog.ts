import type { SkillsConfig } from './skills-types.js';

export type BrainHemisphere = 'left' | 'right';
export type SkillUiCategory = 'core' | 'sales' | 'runtime';

export interface BrainMapItem {
  id: string;
  label: string;
  hemisphere: BrainHemisphere;
  icon: string;
  description: string;
}

export interface SkillFieldDef {
  path: string;
  label: string;
  category: SkillUiCategory;
  group: string;
  priority?: number;
  multiline?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  hint?: string;
  /** When set, Studio renders a select instead of a free-text input. */
  options?: Array<{ value: string | number; label: string }>;
}

/** Left = logic/facts/rules. Right = human tone/skills. */
export const BRAIN_MAP: BrainMapItem[] = [
  { id: 'product-knowledge', label: 'Product Knowledge', hemisphere: 'left', icon: '📚', description: 'Facts, pricing, features (Brain tab)' },
  { id: 'compliance', label: 'Compliance & policies', hemisphere: 'left', icon: '⚖️', description: 'DNC rules, recording disclosure, lead source' },
  { id: 'knowledge-mode', label: 'Knowledge mode', hemisphere: 'left', icon: '🧮', description: 'General knowledge ON/OFF — verified vs LLM fill' },
  { id: 'runtime-engine', label: 'Runtime engine', hemisphere: 'left', icon: '⚙️', description: 'Timers, STT filter, hold mute, barge-in (code)' },
  { id: 'tools', label: 'Tools & actions', hemisphere: 'left', icon: '🔧', description: 'schedule_callback, capture_demo_lead, end_call' },
  { id: 'booking-policy', label: 'Booking policy', hemisphere: 'left', icon: '🧾', description: 'Per-agent save gates — required fields, payment discuss, templates' },
  { id: 'disposition', label: 'Outcomes & records', hemisphere: 'left', icon: '🗂️', description: 'Call disposition, callbacks, leads, events' },
  { id: 'verification', label: 'Contact verification', hemisphere: 'left', icon: '✅', description: 'Email/phone read-back before saving' },
  { id: 'core-skills', label: 'Core call skills', hemisphere: 'right', icon: '🤝', description: 'Busy, DNC, angry, privacy — universal human behavior' },
  { id: 'sales-skills', label: 'Sales skills', hemisphere: 'right', icon: '💼', description: 'Discovery, objection, demo, competitor' },
  { id: 'persona', label: 'Persona & voice', hemisphere: 'right', icon: '🎭', description: 'Tone, greeting, Hinglish, gender grammar' },
  { id: 'language', label: 'Language feel', hemisphere: 'right', icon: '🗣️', description: 'Sticky Hinglish, natural reactions' },
  { id: 'improvisation', label: 'Improvisation', hemisphere: 'right', icon: '✨', description: 'Intent templates — paraphrase, not fixed scripts' },
];

export const RUNTIME_CODE_ITEMS: BrainMapItem[] = [
  { id: 'hold-mute', label: 'Hold mute + check-in', hemisphere: 'left', icon: '⏸️', description: 'Side talk ignored; short Ji ack; exploring mute (call-hold.ts, call-patience.ts)' },
  { id: 'stt-filter', label: 'STT confidence filter', hemisphere: 'left', icon: '🎙️', description: 'Low-quality finals dropped (azure-stt.ts)' },
  { id: 'off-topic-wrap', label: 'Off-topic strike counter', hemisphere: 'left', icon: '🚫', description: 'Force end after max redirects (user-turn-handler)' },
  { id: 'barge-in', label: 'Barge-in / interruption', hemisphere: 'left', icon: '🔀', description: 'Interrupt only after sustained caller speech (no false-interruption resume)' },
  { id: 'noise-nc', label: 'Noise cancellation', hemisphere: 'left', icon: '🔇', description: 'LiveKit BVC on inbound audio' },
  { id: 'transcript-fix', label: 'STT correction pass', hemisphere: 'left', icon: '✏️', description: 'Groq fast model fixes garbled STT' },
];

/** Editable skill fields for Studio UI — path uses dot notation into SkillsConfig. */
export const SKILL_FIELD_DEFS: SkillFieldDef[] = [
  // Core
  { path: 'core.dnc.confirmLine', label: 'DNC confirm', category: 'core', group: 'Do not call', multiline: true },
  { path: 'core.wrongNumber.apologizeLine', label: 'Wrong number — apologize', category: 'core', group: 'Wrong number', multiline: true },
  { path: 'core.gatekeeper.askScript', label: 'Gatekeeper — ask for decision maker', category: 'core', group: 'Gatekeeper / IVR', multiline: true },
  { path: 'core.gatekeeper.callbackOffer', label: 'Gatekeeper — callback offer', category: 'core', group: 'Gatekeeper / IVR', multiline: true },
  { path: 'core.identity.whoIsCalling', label: 'Identity — who is calling', category: 'core', group: 'Identity & privacy', multiline: true },
  { path: 'core.privacy.leadSourceAnswer', label: 'Lead source answer', category: 'core', group: 'Identity & privacy', multiline: true },
  { path: 'core.privacy.recordingObjection', label: 'Recording objection', category: 'core', group: 'Identity & privacy', multiline: true },
  { path: 'core.humanHandoff.acknowledge', label: 'Human agent request', category: 'core', group: 'Handoff & channels', multiline: true },
  { path: 'core.detailsChannel.sendDetailsPromise', label: 'WhatsApp / email details', category: 'core', group: 'Handoff & channels', multiline: true },
  { path: 'core.abusive.boundaryLine', label: 'Abusive caller boundary', category: 'core', group: 'Angry & abuse', multiline: true },
  { path: 'core.silence.checkInLine', label: 'Silence — check-in', category: 'core', group: 'Audio & silence', multiline: true },
  { path: 'core.silence.goodbyeLine', label: 'Silence — goodbye', category: 'core', group: 'Audio & silence', multiline: true },
  { path: 'core.audioIssue.checkLine', label: 'Audio issue — check', category: 'core', group: 'Audio & silence', multiline: true },
  { path: 'core.audioIssue.callbackOffer', label: 'Audio issue — callback', category: 'core', group: 'Audio & silence', multiline: true },
  { path: 'core.voicemail.messageScript', label: 'Voicemail message', category: 'core', group: 'Voicemail / IVR', multiline: true },
  { path: 'core.ivr.receptionistScript', label: 'Receptionist / operator', category: 'core', group: 'Voicemail / IVR', multiline: true },
  { path: 'angry.acknowledge', label: 'Acknowledge', category: 'core', group: 'Angry / frustrated', priority: 1, multiline: true },
  { path: 'angry.deescalate', label: 'De-escalate', category: 'core', group: 'Angry / frustrated', multiline: true },
  { path: 'busy.acknowledge', label: 'Acknowledge', category: 'core', group: 'Busy / callback', priority: 3, multiline: true },
  { path: 'busy.callbackQuestion', label: 'Callback question', category: 'core', group: 'Busy / callback', multiline: true },
  { path: 'busy.confirmTemplate', label: 'Confirm template', category: 'core', group: 'Busy / callback', multiline: true },
  { path: 'support.acknowledge', label: 'Acknowledge', category: 'core', group: 'Support / existing customer', multiline: true },
  { path: 'support.collectContact', label: 'Collect contact', category: 'core', group: 'Support / existing customer', multiline: true },
  { path: 'support.handoffPromise', label: 'Handoff promise', category: 'core', group: 'Support / existing customer', multiline: true },
  { path: 'unclear.intentConfirmTemplate', label: 'Intent confirm', category: 'core', group: 'Unclear speech', multiline: true },
  { path: 'exit.notInterestedLine', label: 'Not interested', category: 'core', group: 'Exit', multiline: true },
  { path: 'exit.politeClose', label: 'Polite close', category: 'core', group: 'Exit', multiline: true },
  { path: 'offTopic.refusalTemplate', label: 'Off-topic refusal', category: 'core', group: 'Off-topic & timepass', multiline: true },
  { path: 'offTopic.personalRefusalTemplate', label: 'Personal refusal', category: 'core', group: 'Off-topic & timepass', multiline: true },
  { path: 'offTopic.redirectQuestion', label: 'Redirect question', category: 'core', group: 'Off-topic & timepass', multiline: true },
  { path: 'timepass.redirectLine', label: 'Timepass redirect', category: 'core', group: 'Off-topic & timepass', multiline: true },
  { path: 'timepass.exitLine', label: 'Timepass exit', category: 'core', group: 'Off-topic & timepass', multiline: true },
  { path: 'compliance.recordingDisclosure', label: 'Recording disclosure', category: 'core', group: 'Compliance', multiline: true },
  // Sales
  { path: 'objection.empathyLine', label: 'Empathy', category: 'sales', group: 'Objection', priority: 5, multiline: true },
  { path: 'objection.priceResponse', label: 'Price / budget', category: 'sales', group: 'Objection', multiline: true },
  { path: 'objection.excelResponse', label: 'Happy with current', category: 'sales', group: 'Objection', multiline: true },
  { path: 'objection.thinkItOverResponse', label: 'Think it over', category: 'sales', group: 'Objection', multiline: true },
  { path: 'competitor.boundaryTemplate', label: 'Competitor boundary', category: 'sales', group: 'Competitor', multiline: true },
  { path: 'competitor.pivotQuestion', label: 'Pivot question', category: 'sales', group: 'Competitor', multiline: true },
  { path: 'competitor.demoBridge', label: 'Demo bridge', category: 'sales', group: 'Competitor', multiline: true },
  { path: 'discovery.openQuestion', label: 'Open question', category: 'sales', group: 'Discovery', multiline: true },
  { path: 'discovery.painProbe', label: 'Pain probe', category: 'sales', group: 'Discovery', multiline: true },
  { path: 'discovery.currentToolsQuestion', label: 'Current tools', category: 'sales', group: 'Discovery', multiline: true },
  { path: 'demoOfferScript', label: 'Demo offer script', category: 'sales', group: 'Demo', multiline: true },
  // Runtime (limits + contact templates)
  { path: 'offTopic.maxRedirects', label: 'Max off-topic redirects', category: 'runtime', group: 'Limits', hint: 'After this many redirects → polite end' },
  { path: 'timepass.maxCasualTurns', label: 'Max casual turns', category: 'runtime', group: 'Limits', hint: 'Timepass banter limit before end' },
  { path: 'runtime.holdAckLine', label: 'Hold ack line', category: 'runtime', group: 'Timers', hint: 'One short word when caller asks to hold (e.g. Ji.)', multiline: true },
  { path: 'runtime.exploringSilenceMs', label: 'Exploring silence (ms)', category: 'runtime', group: 'Timers', hint: 'Mute after hmm/exploring turns' },
  { path: 'runtime.holdSoftCheckinMs', label: 'Hold check-in (ms)', category: 'runtime', group: 'Timers', hint: 'Soft check-in while caller on hold' },
  { path: 'runtime.silenceFirstPromptSec', label: 'Silence first prompt (sec)', category: 'runtime', group: 'Timers', hint: 'No user reply for this long → check-in line (default 120s)' },
  { path: 'runtime.silenceEndSec', label: 'Silence end call (sec)', category: 'runtime', group: 'Timers', hint: 'Still silent after this total → goodbye + end (default 150s)' },
  {
    path: 'runtime.leadMemoryRetentionHours',
    label: 'Lead memory retention',
    category: 'runtime',
    group: 'Lead memory',
    hint: 'How long this agent remembers contact identity + open bookings. Used/past bookings stay silent unless the caller recalls them.',
    options: [
      { value: 0, label: 'Off (no memory)' },
      { value: 24, label: 'Last 24 hours' },
      { value: 48, label: 'Last 48 hours' },
      { value: 168, label: 'Last 7 days' },
      { value: 720, label: 'Last 30 days' },
    ],
  },
  { path: 'demo.nameConfirmTemplate', label: 'Name confirm', category: 'runtime', group: 'Demo contact', multiline: true },
  { path: 'demo.nameSpellRetryTemplate', label: 'Name spell retry', category: 'runtime', group: 'Demo contact', multiline: true },
  { path: 'demo.phoneConfirmTemplate', label: 'Phone confirm', category: 'runtime', group: 'Demo contact', multiline: true },
  { path: 'demo.phoneSpellRetryTemplate', label: 'Phone spell retry', category: 'runtime', group: 'Demo contact', multiline: true },
];

export function getSkillFieldValue(skills: SkillsConfig, path: string): string | number | undefined {
  const parts = path.split('.');
  let cur: unknown = skills;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur === 'string' || typeof cur === 'number') return cur;
  return undefined;
}

export function setSkillFieldValue(
  skills: SkillsConfig,
  path: string,
  value: string | number,
): SkillsConfig {
  const parts = path.split('.');
  const clone = structuredClone(skills) as unknown as Record<string, unknown>;
  let cur: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (cur[key] == null || typeof cur[key] !== 'object') {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
  return clone as unknown as SkillsConfig;
}

export function skillFieldsByCategory(category: SkillUiCategory): SkillFieldDef[] {
  return SKILL_FIELD_DEFS.filter((f) => f.category === category);
}

export function groupedSkillFields(category: SkillUiCategory): Map<string, SkillFieldDef[]> {
  const map = new Map<string, SkillFieldDef[]>();
  for (const field of skillFieldsByCategory(category)) {
    const list = map.get(field.group) ?? [];
    list.push(field);
    map.set(field.group, list);
  }
  return map;
}

export function brainItemsByHemisphere(hemisphere: BrainHemisphere): BrainMapItem[] {
  return BRAIN_MAP.filter((b) => b.hemisphere === hemisphere);
}
