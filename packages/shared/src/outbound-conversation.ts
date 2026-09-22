/**
 * Outbound-only conversation policy.
 * Inbound behavior is unchanged — callers must pass direction === 'outbound'.
 */

export type OutboundIntent =
  | 'open'
  | 'discover'
  | 'sku_qa'
  | 'compare'
  | 'book'
  | 'hold';

export type OutboundFocusState = {
  intent: OutboundIntent;
  model: string | null;
  variant: string | null;
  lastAnsweredVariant: string | null;
  alreadySaid: string[];
  audioRepair: boolean;
};

export function emptyOutboundFocus(): OutboundFocusState {
  return {
    intent: 'open',
    model: null,
    variant: null,
    lastAnsweredVariant: null,
    alreadySaid: [],
    audioRepair: false,
  };
}

export type OutboundTurnAction =
  | { kind: 'mute'; reason: string; focus: OutboundFocusState }
  | { kind: 'hold'; focus: OutboundFocusState }
  | { kind: 'audio-check'; focus: OutboundFocusState }
  | {
      kind: 'continue';
      focus: OutboundFocusState;
      systemNote: string;
      skipBuyingPitch: boolean;
    };

const INCOMPLETE_ONLY =
  /^(?:(?:yeah|yes|yep|haan+|han+|ha+|ok|okay|ji|hmm+)\s*[,.]?\s*)?(?:but|lekin|par|tho|toh|and|aur)\s*[.…]?$/i;

const TRAILING_CONNECTOR =
  /\b(but|lekin|par|tho|toh|and|aur|phir|so)\s*[,…]?\s*$/i;

const HELLO_ONLY =
  /^(hello+|h[ae]llo+|hi+|hey+|namaste|namaskar)\s*[.!?]*$/i;

const SORRY_ONLY =
  /^(sorry+|maaf(?:i)?(?:\s*(?:ji|karna|kijiye))?|pardon|excuse\s*me)\s*[.!?]*$/i;

const STAY_ON_LINE =
  /\b(stay\s+on\s+(the\s+)?line|hold\s+(the\s+)?line|please\s+stay(\s+on)?|line\s+pe\s+(rahiye|rehna|reh\s*jao|raho)|line\s+par\s+(rahiye|rehna))\b/i;

const AUDIO_ISSUE =
  /\b(awaa?z|awaaz|voice|audio)\b.{0,28}\b(nahi[n]?|nahin|not|can'?t|cannot|isn'?t)\b|\b(can'?t|cannot|not)\s+hear\b|\b(sun\s*(nahi[n]?|nahin)|nahi[n]?\s*sun)\b|आवा[ज़ज].{0,20}नहीं|नहीं.{0,16}आवा[ज़ज]|आवा[ज़ज].{0,16}चल|चल[ीी].{0,32}आवा[ज़ज]/i;

const AUDIO_FOLLOWUP =
  /\b(wapas|wapis|waapas)\s+aana\s+chahiye\b|वापस\s+आना\s+चाहिए/i;

const AUDIO_RECOVERED =
  /\b(aa\s*rah[iey]|sun\s*(pa\s*)?rah|clear\s*(aa|hai)|awaa?z\s+aa\s*rah)\b|आ\s*रही|सुन\s*(पा)?\s*रह/i;

const AUDIO_RECOVERED_SHORT =
  /^(haan+|han+|ha+|yes|yeah|ji+|ok+|okay+|theek\s*hai)\s*[.!?]*$/i;

const THANK_YOU_ONLY =
  /^(thank\s*you|thanks|thx|dhanyavaad|shukriya|धन्यवाद|शुक्रिया)\s*[.!?]*$/i;

const CONFUSION =
  /\b(i\s+don'?t\s+know(?:\s+about(?:\s+that)?)?|don'?t\s+know\s+about\s+that|mujhe\s+(nahi[n]?|nahin)\s+pata|jaa?nkari\s+nahi[n]?)\b|जानकारी\s*नहीं|\b(kya\s+hota\s+hai|sedan\s+kya|matlab)\b|ऐसी.{0,16}क्या\s+होता|सेडान\s*क्या/i;

const VARIANT_LIST_ASK =
  /\b(variant|varient|varients|variants|trim|trims)\b.{0,40}\b(kaun|kons[ae]|available|hai|hain|which|what)\b|\b(kaun\s+kaun\s+se|which\s+(ones?|variants?))\b|वेरिएंट|वेरियंट/i;

const VARIANT_SPECS: Array<{ id: string; re: RegExp }> = [
  { id: 'GT Plus', re: /\bgt\s*plus\b|जीटी\s*प्लस/i },
  { id: 'GT Line', re: /\bgt\s*line\b|जीटी\s*लाइन/i },
  { id: 'GTI', re: /\bgti\b/i },
  { id: 'GT', re: /\bgt\b|जीटी/i },
  { id: 'R-Line', re: /\br[\s-]*line\b/i },
  { id: 'Comfortline', re: /\bcomfort[\s-]*line\b|कंफर्टलाइन/i },
  { id: 'Highline', re: /\bhigh[\s-]*line\b|हाईलाइन/i },
  { id: 'Topline', re: /\btop[\s-]*line\b|टॉपलाइन/i },
  { id: 'Trendline', re: /\btrend[\s-]*line\b/i },
  { id: 'Sportline', re: /\bsport[\s-]*line\b/i },
  { id: 'Sport', re: /\bsport\b(?!\s*line)/i },
];

const MODEL_RE =
  /\b(virtus|taigun|tiguan|polo|vento|ameo|passat|jetta|t-?roc|t-?cross|slavia|kushaq|city|verna|creta|seltos)\b/i;

type CatalogChunk = {
  title: string;
  body: string;
};

function normalize(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

function wordCount(text: string): number {
  return normalize(text).split(/\s+/).filter(Boolean).length;
}

const PRODUCT_IN_UTTERANCE =
  /\b(sedan|suv|taigun|virtus|tiguan|turbo|e-?20|price|emi|technical|engine|dealer|volkswagen|variant|model)\b|सेडान|एसयूवी|टरबो|ई\s*20|टाइगन|वर्टस/i;

/** Snowballed STT often contains "hello / awaaz" plus the real question — answer the question. */
function shouldSkipAudioCheck(text: string): boolean {
  return wordCount(text) > 16 || PRODUCT_IN_UTTERANCE.test(text);
}

export function isOutboundWaitUtterance(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  if (INCOMPLETE_ONLY.test(t)) return true;
  if (wordCount(t) <= 8 && TRAILING_CONNECTOR.test(t) && !/\?/.test(t)) return true;
  return false;
}

export function isOutboundAttentionUtterance(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return HELLO_ONLY.test(t) || SORRY_ONLY.test(t);
}

export function isOutboundStayOnLineUtterance(text: string): boolean {
  return STAY_ON_LINE.test(normalize(text));
}

export function isOutboundAudioIssueUtterance(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return AUDIO_ISSUE.test(t);
}

export function isOutboundAudioFollowupUtterance(text: string): boolean {
  return AUDIO_FOLLOWUP.test(normalize(text));
}

export function isOutboundAudioRecoveredUtterance(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return AUDIO_RECOVERED.test(t) || AUDIO_RECOVERED_SHORT.test(t);
}

export function isOutboundThankYouUtterance(text: string): boolean {
  return THANK_YOU_ONLY.test(normalize(text));
}

export function isOutboundConfusionUtterance(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return CONFUSION.test(t);
}

/** Cut TTS on outbound when the caller is interrupting without a full question. */
export function shouldOutboundCutSpeech(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  if (isOutboundStayOnLineUtterance(t)) return true;
  if (isOutboundWaitUtterance(t)) return true;
  if (isOutboundAudioIssueUtterance(t)) return true;
  if (isOutboundAttentionUtterance(t)) return true;
  return false;
}

export function extractOutboundVariant(text: string): string | null {
  const t = normalize(text);
  if (!t) return null;
  for (const spec of VARIANT_SPECS) {
    if (spec.re.test(t)) return spec.id;
  }
  return null;
}

export function extractOutboundModel(text: string): string | null {
  const match = normalize(text).match(MODEL_RE);
  if (!match?.[1]) return null;
  const raw = match[1].toLowerCase();
  if (raw === 't-roc' || raw === 'troc') return 'T-Roc';
  if (raw === 't-cross' || raw === 'tcross') return 'T-Cross';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function isOutboundVariantListAsk(text: string): boolean {
  return VARIANT_LIST_ASK.test(normalize(text));
}

function splitCatalogChunks(markdown: string): CatalogChunk[] {
  const source = markdown.trim();
  if (!source) return [];
  const chunks: CatalogChunk[] = [];
  const headingSplit = source.split(/(?=^#{1,3}\s+)/m).map((part) => part.trim()).filter(Boolean);
  const parts = headingSplit.length > 1 ? headingSplit : [source];
  for (const part of parts) {
    const lines = part.split('\n');
    const title = lines[0]?.replace(/^#+\s*/, '').trim() || 'Product';
    const body = lines.slice(1).join('\n').trim() || part;
    chunks.push({ title, body });
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*•]\s+\*?\*?([^*\n:]{2,40})\*?\*?\s*[:–-]/);
      if (bullet?.[1]) {
        chunks.push({ title: bullet[1].trim(), body: line.trim() });
      }
    }
  }
  return chunks;
}

function chunkHasVariant(chunk: CatalogChunk, variant: string): boolean {
  const hay = `${chunk.title}\n${chunk.body}`;
  const spec = VARIANT_SPECS.find((item) => item.id.toLowerCase() === variant.toLowerCase());
  if (spec) return spec.re.test(hay);
  const re = new RegExp(`\\b${variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return re.test(hay);
}

function chunkHasModel(chunk: CatalogChunk, model: string): boolean {
  const hay = `${chunk.title}\n${chunk.body}`;
  const re = new RegExp(`\\b${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return re.test(hay);
}

export function retrieveOutboundCatalog(opts: {
  knowledge: string;
  model: string | null;
  variant: string | null;
  listVariants: boolean;
}): { found: boolean; snippet: string } {
  const knowledge = opts.knowledge.trim();
  if (!knowledge) {
    return { found: false, snippet: '' };
  }
  const chunks = splitCatalogChunks(knowledge);

  if (opts.variant) {
    let hits = chunks.filter((chunk) => chunkHasVariant(chunk, opts.variant!));
    if (opts.variant.toLowerCase() === 'gt') {
      hits = hits.filter(
        (chunk) => !/^\s*sport\b/i.test(chunk.title) || /\bgt\b/i.test(`${chunk.title}\n${chunk.body}`),
      );
    }
    const titled = hits.filter((chunk) =>
      chunk.title.toLowerCase().includes(opts.variant!.toLowerCase()),
    );
    if (titled.length) hits = titled;
    if (opts.model) {
      const withModel = hits.filter((chunk) => chunkHasModel(chunk, opts.model!));
      if (withModel.length) hits = withModel;
    }
    if (!hits.length) {
      return { found: false, snippet: '' };
    }
    const snippet = hits
      .slice(0, 3)
      .map((chunk) => `${chunk.title}\n${chunk.body}`.trim())
      .join('\n\n')
      .slice(0, 1400);
    return { found: true, snippet };
  }

  if (opts.listVariants || opts.model) {
    const scoped = opts.model
      ? chunks.filter((chunk) => chunkHasModel(chunk, opts.model!))
      : chunks;
    const pool = scoped.length ? scoped : chunks;
    const names = new Set<string>();
    for (const chunk of pool) {
      const hay = `${chunk.title}\n${chunk.body}`;
      for (const spec of VARIANT_SPECS) {
        if (spec.re.test(hay)) names.add(spec.id);
      }
    }
    const snippet = (pool.slice(0, 4).map((c) => `${c.title}\n${c.body}`.trim()).join('\n\n') || knowledge).slice(
      0,
      1400,
    );
    const listed = [...names].join(', ');
    return {
      found: true,
      snippet: listed ? `Listed variants in knowledge: ${listed}.\n\n${snippet}` : snippet,
    };
  }

  return { found: true, snippet: knowledge.slice(0, 1200) };
}

export function rememberOutboundAssistant(
  focus: OutboundFocusState,
  assistantText: string,
): OutboundFocusState {
  const text = assistantText.trim();
  if (!text) return focus;
  const alreadySaid = [...focus.alreadySaid, text.slice(0, 280)].slice(-8);
  return {
    ...focus,
    lastAnsweredVariant: focus.variant ?? focus.lastAnsweredVariant,
    alreadySaid,
    audioRepair: focus.audioRepair ?? false,
  };
}

export function applyOutboundConversationTurn(opts: {
  text: string;
  productName: string;
  productKnowledge: string;
  focus: OutboundFocusState;
  phoneCaptureActive?: boolean;
  /** False while the outbound opener has not been spoken yet — pickup hello is not muted. */
  openerDelivered?: boolean;
}): OutboundTurnAction {
  const text = normalize(opts.text);
  let focus = {
    ...opts.focus,
    alreadySaid: [...opts.focus.alreadySaid],
    audioRepair: opts.focus.audioRepair ?? false,
  };

  if (!opts.phoneCaptureActive && isOutboundStayOnLineUtterance(text)) {
    focus.intent = 'hold';
    return { kind: 'hold', focus };
  }

  if (!opts.phoneCaptureActive && focus.audioRepair) {
    if (isOutboundThankYouUtterance(text)) {
      return { kind: 'mute', reason: 'outbound-audio-thanks', focus };
    }
    if (
      !shouldSkipAudioCheck(text) &&
      (isOutboundAudioIssueUtterance(text) ||
        isOutboundAudioFollowupUtterance(text) ||
        isOutboundAttentionUtterance(text))
    ) {
      focus.audioRepair = true;
      return { kind: 'audio-check', focus };
    }
    if (isOutboundAudioRecoveredUtterance(text)) {
      focus.audioRepair = false;
    } else {
      focus.audioRepair = false;
    }
  }

  if (!opts.phoneCaptureActive && !shouldSkipAudioCheck(text) && isOutboundAudioIssueUtterance(text)) {
    focus.audioRepair = true;
    return { kind: 'audio-check', focus };
  }

  if (!opts.phoneCaptureActive && isOutboundWaitUtterance(text)) {
    return { kind: 'mute', reason: 'outbound-incomplete', focus };
  }

  if (!opts.phoneCaptureActive && isOutboundAttentionUtterance(text)) {
    if (opts.openerDelivered === false && focus.intent === 'open') {
      return { kind: 'mute', reason: 'outbound-pickup-awaiting-opener', focus };
    }
    if (opts.openerDelivered !== true) {
      return { kind: 'mute', reason: 'outbound-attention', focus };
    }
    // After opener: let LLM acknowledge ("Ji, boliye") — do not mute.
  }

  const confused = isOutboundConfusionUtterance(text);

  const utteredModel = extractOutboundModel(text);
  const utteredVariant = extractOutboundVariant(text);
  if (utteredModel && utteredModel !== focus.model && !utteredVariant) {
    focus.variant = null;
  }
  const model = utteredModel ?? focus.model;
  const variant = utteredVariant;
  const listAsk = isOutboundVariantListAsk(text);
  const repairing =
    Boolean(variant) &&
    Boolean(focus.lastAnsweredVariant) &&
    variant!.toLowerCase() !== focus.lastAnsweredVariant!.toLowerCase();

  if (variant) {
    focus.variant = variant;
    focus.intent = 'sku_qa';
  } else if (listAsk) {
    focus.intent = 'sku_qa';
  } else if (model && model !== focus.model) {
    focus.intent = 'discover';
  }
  if (model) focus.model = model;

  const retrieval = retrieveOutboundCatalog({
    knowledge: opts.productKnowledge,
    model: focus.model,
    variant: focus.variant,
    listVariants: listAsk && !variant,
  });

  const lines: string[] = [
    '[SYSTEM: OUTBOUND conversation policy — this call only.]',
    'Answer THIS turn only. Default 1-2 short spoken sentences. Do not recap the catalog.',
    'Do not infer that one trim/variant is another (never GT = Sport unless Product Knowledge states that exact alias).',
  ];

  if (focus.model) lines.push(`Current model in focus: ${focus.model}.`);
  if (focus.variant) {
    lines.push(
      `Current variant in focus: ${focus.variant}. Stay on this variant until the caller changes it.`,
    );
  }
  if (repairing) {
    lines.push(
      `REPAIR: You previously talked about ${focus.lastAnsweredVariant}. The caller wants ${focus.variant}. Stop the previous explanation. Do not mix the two.`,
    );
  }
  if (listAsk && !variant) {
    lines.push(
      'They asked which variants exist. Name only variants that appear in the retrieved Product Knowledge, then ask which one. Do not describe every spec.',
    );
  }
  if (focus.variant) {
    if (retrieval.found && retrieval.snippet) {
      lines.push(
        `Authoritative Product Knowledge for ${focus.variant} (use ONLY this; do not fill from general knowledge):`,
      );
      lines.push(retrieval.snippet);
    } else {
      lines.push(
        `${focus.variant} was not found as its own variant in Product Knowledge. Say you only have verified listed variants. Do NOT substitute Sport or any other trim.`,
      );
    }
  } else if (retrieval.found && retrieval.snippet && (listAsk || focus.model)) {
    lines.push('Retrieved Product Knowledge for this ask:');
    lines.push(retrieval.snippet);
  }
  if (focus.alreadySaid.length) {
    lines.push(
      'Do not repeat prices, variant lists, or explanations you already spoke this call:',
    );
    lines.push(focus.alreadySaid.slice(-3).join(' | '));
  }
  lines.push(`Product: ${opts.productName}.`);

  return {
    kind: 'continue',
    focus,
    systemNote: lines.join('\n'),
    skipBuyingPitch: Boolean(
      variant || listAsk || repairing || confused || focus.intent === 'sku_qa',
    ),
  };
}

export function productKnowledgeFromSources(
  brainSummary?: string | null,
  compiledPrompt?: string | null,
): string {
  const summary = brainSummary?.trim() ?? '';
  if (summary.length > 80) return summary;
  const compiled = compiledPrompt ?? '';
  const marker = '\n## Product Knowledge';
  const idx = compiled.indexOf(marker);
  if (idx >= 0) {
    const rest = compiled.slice(idx + marker.length);
    const next = rest.search(/\n## /);
    const section = (next >= 0 ? rest.slice(0, next) : rest).trim();
    if (section) return section;
  }
  return summary || compiled.slice(0, 4000);
}
