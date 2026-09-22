export type CallerStyle = 'casual' | 'formal' | 'direct' | 'friendly' | 'neutral';

export const MAX_GLOBAL_LEARNING_BULLETS = 15;

export const GLOBAL_LEARNING_CATEGORIES = [
  'objection',
  'situation',
  'discovery',
  'qualification',
  'approach',
  'competitor',
  'vertical',
  'closing',
  'reengage',
  'exit',
  'faq',
  'gap',
  'pricing',
  'negative_sentiment',
  'abuse',
  'other',
] as const;

export type GlobalLearningCategory = (typeof GLOBAL_LEARNING_CATEGORIES)[number];

const AUTO_APPLY_CATEGORIES = new Set<string>([
  'objection',
  'situation',
  'discovery',
  'qualification',
  'approach',
  'vertical',
  'closing',
  'reengage',
  'exit',
  'faq',
]);

const STOP_WORDS = new Set([
  'that',
  'this',
  'with',
  'from',
  'when',
  'what',
  'your',
  'they',
  'them',
  'have',
  'been',
  'will',
  'about',
  'into',
  'offer',
  'call',
  'demo',
]);

export interface TranscriptLineInput {
  role: 'user' | 'agent';
  text: string;
}

export function prospectKeyFromName(name?: string | null): string | null {
  const trimmed = name?.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, ' ');
}

export function detectCallerStyle(userLines: string[]): CallerStyle {
  const text = userLines.join(' ').toLowerCase();
  if (!text.trim()) return 'neutral';

  const casualHits =
    (text.match(/\b(yaar|bhai|arre|bro|dude|chal|theek ha|thik ha)\b/gi) ?? []).length;
  const formalHits =
    (text.match(/\b(sir|madam|kindly|please|regards|dear)\b/gi) ?? []).length;
  const directHits =
    (text.match(/\b(jaldi|quick|fast|bas|short|brief)\b/gi) ?? []).length;
  const friendlyHits =
    (text.match(/\b(haan ji|namaste|thanks|thank you|haha|lol)\b/gi) ?? []).length;

  const avgWords =
    userLines.length > 0
      ? userLines.reduce((n, l) => n + l.split(/\s+/).filter(Boolean).length, 0) /
        userLines.length
      : 0;

  if (directHits > 0 || avgWords <= 6) return 'direct';
  if (formalHits > casualHits && formalHits > 0) return 'formal';
  if (casualHits > 0) return 'casual';
  if (friendlyHits > 0) return 'friendly';
  return 'neutral';
}

export function parseCallerStyle(raw?: string | null): CallerStyle {
  const s = (raw ?? 'neutral').toLowerCase().trim();
  if (s === 'casual' || s === 'formal' || s === 'direct' || s === 'friendly') return s;
  return 'neutral';
}

export function buildCallerStylePrompt(style: CallerStyle): string {
  const lines: Record<CallerStyle, string> = {
    casual:
      '- Caller speaks casually. Match their energy: warm, simple, slightly informal (still professional sales).\n- Use natural Hinglish in Roman script when they do. Do not sound more formal than the caller.',
    formal:
      '- Caller speaks formally. Be respectful and structured. Use polite forms (sir/madam when natural).\n- Keep answers clear and professional.',
    direct:
      '- Caller is brief or in a hurry. Keep replies short — one sentence plus one question max. No long pitches.',
    friendly:
      '- Caller is chatty and friendly. Be warm and rapport-first, then guide to product value.',
    neutral:
      '- Match the caller\'s energy and sentence length. Do not sound more formal than they do.',
  };

  return `## Caller style (mirror this)
${lines[style]}
- Mirror speaking style only — never mirror rudeness or abuse.
- Product facts must still come only from Product Knowledge.`;
}

export function buildLearningsPrompt(brainLearnings?: string | null): string {
  const trimmed = brainLearnings?.trim();
  if (!trimmed) return '';
  return `## Learned from conversations
${capMarkdownSection(trimmed, 800)}`;
}

export function buildProspectPrompt(
  factsMarkdown?: string | null,
  callerStyle?: string | null,
  contact?: {
    displayName?: string | null;
    email?: string | null;
    phone?: string | null;
  },
): string {
  const facts = factsMarkdown?.trim();
  const style = callerStyle?.trim();
  const name = contact?.displayName?.trim();
  const email = contact?.email?.trim();
  const phone = contact?.phone?.trim();
  if (!facts && !style && !name && !email && !phone) return '';

  const parts: string[] = ['## This prospect'];
  if (name) parts.push(`Name: ${name}`);
  if (phone) parts.push(`Phone: ${phone}`);
  if (email) parts.push(`Email: ${email}`);
  if (facts) parts.push(capMarkdownSection(facts, 400));
  if (style) parts.push(`Communication style: ${style}`);
  return parts.join('\n');
}

export function capMarkdownSection(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}…`;
}

export function appendUniqueBullet(existing: string, bullet: string): string {
  const line = bullet.trim().replace(/^[-*]\s*/, '');
  if (!line) return existing;
  const normalized = line.toLowerCase();
  if (existing.toLowerCase().includes(normalized)) return existing;
  const prefix = existing.trim() ? `${existing.trim()}\n` : '';
  return `${prefix}- ${line}`;
}

export function normalizeGlobalCategory(raw?: string | null): GlobalLearningCategory {
  const s = (raw ?? 'other').toLowerCase().trim();
  if ((GLOBAL_LEARNING_CATEGORIES as readonly string[]).includes(s)) {
    return s as GlobalLearningCategory;
  }
  if (s === 'product_claim') return 'gap';
  return 'other';
}

export function buildKnowledgeCorpus(parts: {
  brainSummary?: string | null;
  brainMarkdown?: string | null;
  brainLearnings?: string | null;
}): string {
  const summary = parts.brainSummary?.trim() ?? '';
  const markdown = parts.brainMarkdown?.trim().slice(0, 3000) ?? '';
  const learnings = parts.brainLearnings?.trim() ?? '';
  return [summary, markdown, learnings].filter(Boolean).join('\n');
}

function learningTextForCompare(bullet: string): string {
  return bullet
    .trim()
    .replace(/^-\s*/, '')
    .replace(/^\[[\w_]+\]\s*/i, '')
    .toLowerCase();
}

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

export function isDuplicateKnowledge(bullet: string, corpus: string): boolean {
  const line = learningTextForCompare(bullet);
  if (!line) return true;
  const corpLower = corpus.toLowerCase();
  if (corpLower.includes(line)) return true;

  const words = significantWords(line);
  if (words.length >= 3) {
    const matched = words.filter((w) => corpLower.includes(w)).length;
    if (matched / words.length >= 0.75) return true;
  }
  return false;
}

export function looksLikeAbuseOrInsult(text: string): boolean {
  return /\b(bekaar|kachra|kachra|idiot|stupid|shit|damn|hate you|worst|useless|garbage)\b/i.test(
    text,
  );
}

export function looksLikePricingClaim(text: string): boolean {
  return /(?:₹|rs\.?|inr|\$\d|\d+\s*(?:\/mo|per month|per year|k\/month))/i.test(text);
}

export function formatGlobalLearningBullet(category: string, text: string): string {
  const cat = normalizeGlobalCategory(category);
  const clean = text.trim().replace(/^[-*]\s*/, '').replace(/^\[[\w_]+\]\s*/i, '');
  if (!clean) return '';
  if (clean.toLowerCase().startsWith(`[${cat}]`)) return `- ${clean}`;
  return `- [${cat}] ${clean}`;
}

export function canAutoApplyGlobalCategory(category: string, text: string): boolean {
  if (looksLikeAbuseOrInsult(text)) return false;
  if (looksLikePricingClaim(text)) return false;
  const cat = normalizeGlobalCategory(category);
  if (['abuse', 'negative_sentiment', 'pricing', 'gap', 'other'].includes(cat)) return false;
  if (cat === 'competitor') return false;
  return AUTO_APPLY_CATEGORIES.has(cat);
}

export function appendGlobalLearning(
  existing: string,
  bullet: string,
  maxBullets = MAX_GLOBAL_LEARNING_BULLETS,
): string {
  const withNew = appendUniqueBullet(existing, bullet);
  const lines = withNew.split('\n').filter((l) => l.trim());
  if (lines.length <= maxBullets) return lines.join('\n');
  return lines.slice(-maxBullets).join('\n');
}

export function isProspectLearningAllowed(text: string): boolean {
  return !looksLikeAbuseOrInsult(text);
}

export function linesFromTranscriptPayload(
  transcript: unknown,
): TranscriptLineInput[] {
  if (!transcript) return [];
  if (Array.isArray(transcript)) {
    return transcript
      .filter((l): l is TranscriptLineInput => !!l && typeof l === 'object' && 'text' in l)
      .map((l) => ({
        role: l.role === 'agent' ? 'agent' : 'user',
        text: String(l.text),
      }));
  }
  if (typeof transcript === 'object' && transcript !== null && 'lines' in transcript) {
    const lines = (transcript as { lines?: unknown }).lines;
    return linesFromTranscriptPayload(lines);
  }
  return [];
}
