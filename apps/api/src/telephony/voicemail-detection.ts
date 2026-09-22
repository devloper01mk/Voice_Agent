export type AmdClassification = 'voicemail' | 'human' | 'unknown';

const VOICEMAIL_STRONG_RE =
  /\b(leave (?:a |your )?message|after the (?:tone|beep)|at the tone|voicemail|voice mail|not available|unable to take (?:your )?call|record (?:your )?message|mailbox is full|please record)\b/i;

const VOICEMAIL_HINT_RE =
  /\b(call (?:you|u) back|reach(?:ed)? (?:you|u)|try again later|unavailable|not reachable|sandesh chhod|message chhod|message chhode|available nahi|uplabdh nahi|baad mein call|tone ke baad|beep ke baad|ghanti ke baad)\b/i;

const HUMAN_STRONG_RE =
  /^(?:hello|hi|hey|haan|han|ji|yes|yeah|boliye|bolo|kaun|who(?:'s| is) this|speaking|namaste|hola)(?:\s+ji)?[.!?\s]*$/i;

const HUMAN_INTERACTIVE_RE =
  /\b(kaun hai|kaun bol|who is (?:this|calling)|boliye|sun (?:rahe|rahi)|haan ji|ji boliye|yes sir|yes ma'am)\b/i;

export function resolveAmdTimeoutMs(): number {
  const raw = Number(process.env.TELEPHONY_AMD_TIMEOUT_MS ?? 1_800);
  return Number.isFinite(raw) && raw >= 1_200 ? raw : 1_800;
}

export function resolveVoicemailBeepWaitMs(): number {
  const raw = Number(process.env.TELEPHONY_VOICEMAIL_BEEP_WAIT_MS ?? 1_500);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1_500;
}

export function isVoicemailDetectionEnabled(): boolean {
  const raw = process.env.TELEPHONY_VOICEMAIL_DETECTION?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return true;
}

export function classifyAmdSpeech(
  text: string,
  opts?: { cumulative?: string; connectedMs?: number },
): AmdClassification {
  const chunk = text.trim();
  if (!chunk) return 'unknown';

  const cumulative = `${opts?.cumulative ?? ''} ${chunk}`.trim();
  const lower = cumulative.toLowerCase();

  if (HUMAN_STRONG_RE.test(chunk.trim())) return 'human';
  if (HUMAN_INTERACTIVE_RE.test(lower)) return 'human';

  if (VOICEMAIL_STRONG_RE.test(lower)) return 'voicemail';
  if (VOICEMAIL_HINT_RE.test(lower) && lower.split(/\s+/).length >= 6) return 'voicemail';

  const connectedMs = opts?.connectedMs ?? 0;
  if (connectedMs >= 4_000 && lower.length >= 90 && !/\?/.test(chunk) && !HUMAN_INTERACTIVE_RE.test(lower)) {
    if (VOICEMAIL_HINT_RE.test(lower) || /\b(thank you for calling|you have reached|this is)\b/i.test(lower)) {
      return 'voicemail';
    }
  }

  return 'unknown';
}

export function buildVoicemailMessage(
  template: string,
  agentName: string,
  productName: string,
  agentGender?: string,
): string {
  let script = template
    .replaceAll('{product_name}', productName)
    .replaceAll('{agent_name}', agentName)
    .trim();
  if (agentGender === 'male') {
    script = script
      .replaceAll('bol rehi hoon', 'bol raha hoon')
      .replaceAll('kar rehi hoon', 'kar raha hoon')
      .replaceAll('chhod sakti hoon', 'chhod sakta hoon');
  }
  return script;
}

export function defaultVoicemailScript(agentName: string, productName: string): string {
  return buildVoicemailMessage(
    'Namaste, main {agent_name} bol rehi hoon {product_name} se. Aap free hon to callback kar lijiye. Dhanyavaad.',
    agentName,
    productName,
  );
}
