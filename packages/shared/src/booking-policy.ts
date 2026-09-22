import type { BookingType } from './schedule-parse.js';

/**
 * Per-agent booking / lead-save policy. Brain holds product facts; this holds
 * process gates + product-specific booking vocabulary (what to save / say).
 */

export type BookingOutcome = 'demo' | 'visit' | 'stay' | 'callback' | 'lead_only';

export type BookingRequiredField =
  | 'preferred_time'
  | 'name'
  | 'phone'
  | 'party_size'
  | 'email';

export type BookingDiscussGate = 'payment' | 'cancellation' | 'id_proof' | 'budget';

export type BookingPolicyTemplateId =
  | 'crm_demo'
  | 'hotel_stay'
  | 'auto_test_drive'
  | 'custom';

export type BookingLocationType = 'showroom' | 'home' | 'online' | 'hotel';

export interface BookingPolicy {
  /** Preset used to seed this policy (UI hint). */
  templateId: BookingPolicyTemplateId;
  /** What a successful save means for this agent. */
  outcome: BookingOutcome;
  /**
   * Default Lead.bookingType slug for this agent (e.g. stay, demo, showroom_visit).
   * Product-specific — not a global hardcoded tool enum.
   */
  bookingType: string;
  /**
   * What the agent must say after capture_demo_lead ok:true
   * (e.g. "hotel stay booking" — never invent showroom/demo wording).
   */
  speakAs: string;
  /**
   * booking_type values offered to the model for THIS agent only.
   * Hotel → ["stay"]; auto → ["showroom_visit","test_drive"]; CRM → ["demo"].
   */
  allowedBookingTypes: string[];
  /** Default Lead.locationType for saves. */
  locationType: BookingLocationType;
  /** Fields that must be confirmed before capture_demo_lead. */
  requiredFields: BookingRequiredField[];
  /** Topics that must be discussed (from Product Knowledge) before save. */
  discussBeforeSave: BookingDiscussGate[];
  /** When false, never ask email — save with email_skipped=true. */
  askEmail: boolean;
  /** Extra free-text rules injected into the system prompt. */
  notes: string;
}

/** Seed vocabulary from outcome when older agents lack explicit fields. */
export function vocabularyForOutcome(outcome: BookingOutcome): {
  bookingType: string;
  speakAs: string;
  allowedBookingTypes: string[];
  locationType: BookingLocationType;
} {
  switch (outcome) {
    case 'stay':
      return {
        bookingType: 'stay',
        speakAs: 'hotel stay booking',
        allowedBookingTypes: ['stay'],
        locationType: 'hotel',
      };
    case 'visit':
      return {
        bookingType: 'showroom_visit',
        speakAs: 'showroom visit or test drive',
        allowedBookingTypes: ['showroom_visit', 'test_drive'],
        locationType: 'showroom',
      };
    case 'callback':
      return {
        bookingType: 'demo',
        speakAs: 'callback',
        allowedBookingTypes: ['demo'],
        locationType: 'online',
      };
    case 'lead_only':
      return {
        bookingType: 'demo',
        speakAs: 'lead',
        allowedBookingTypes: ['demo'],
        locationType: 'online',
      };
    case 'demo':
    default:
      return {
        bookingType: 'demo',
        speakAs: 'product demo',
        allowedBookingTypes: ['demo'],
        locationType: 'online',
      };
  }
}

export const DEFAULT_BOOKING_POLICY: BookingPolicy = {
  templateId: 'crm_demo',
  outcome: 'demo',
  ...vocabularyForOutcome('demo'),
  requiredFields: ['preferred_time', 'name', 'phone'],
  discussBeforeSave: [],
  askEmail: false,
  notes: '',
};

export const BOOKING_POLICY_TEMPLATES: Record<
  Exclude<BookingPolicyTemplateId, 'custom'>,
  { label: string; description: string; policy: BookingPolicy }
> = {
  crm_demo: {
    label: 'CRM / SaaS demo',
    description: 'Schedule a product demo — time, name, phone. No payment gate.',
    policy: {
      templateId: 'crm_demo',
      outcome: 'demo',
      ...vocabularyForOutcome('demo'),
      requiredFields: ['preferred_time', 'name', 'phone'],
      discussBeforeSave: [],
      askEmail: false,
      notes: '',
    },
  },
  hotel_stay: {
    label: 'Hotel / stay booking',
    description: 'Stay booking — dates, guests, name, phone; discuss payment/advance first.',
    policy: {
      templateId: 'hotel_stay',
      outcome: 'stay',
      ...vocabularyForOutcome('stay'),
      requiredFields: ['preferred_time', 'party_size', 'name', 'phone'],
      discussBeforeSave: ['payment'],
      askEmail: false,
      notes:
        'Use Product Knowledge for advance/deposit/cancellation only when saving/booking. Do not say booking confirmed until payment options were explained and acknowledged. Never pitch payment on every turn.',
    },
  },
  auto_test_drive: {
    label: 'Auto test drive / visit',
    description: 'Showroom visit or test drive — slot, name, phone. No payment on call.',
    policy: {
      templateId: 'auto_test_drive',
      outcome: 'visit',
      ...vocabularyForOutcome('visit'),
      requiredFields: ['preferred_time', 'name', 'phone'],
      discussBeforeSave: [],
      askEmail: false,
      notes: '',
    },
  },
};

const FIELD_LABELS: Record<BookingRequiredField, string> = {
  preferred_time: 'preferred date/time (confirm absolute date via Call time IST)',
  name: 'full name (read-back + yes/haan)',
  phone: 'phone (read-back + yes/haan)',
  party_size: 'number of guests / people',
  email: 'email (read-back + yes/haan)',
};

const GATE_LABELS: Record<BookingDiscussGate, string> = {
  payment: 'payment / advance / deposit options from Product Knowledge',
  cancellation: 'cancellation / refund policy from Product Knowledge',
  id_proof: 'ID / check-in document requirements from Product Knowledge',
  budget: 'budget fit from Product Knowledge (no invented prices)',
};

const OUTCOME_LABELS: Record<BookingOutcome, string> = {
  demo: 'product demo',
  visit: 'showroom visit / test drive',
  stay: 'stay / hotel booking',
  callback: 'callback only (prefer schedule_callback)',
  lead_only: 'lead capture without a timed booking',
};

function uniq<T extends string>(items: T[]): T[] {
  return [...new Set(items)];
}

/** Normalize a booking type slug: "Hotel Stay" → "hotel_stay". */
export function normalizeBookingTypeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

function sanitizeAllowed(types: unknown, fallback: string[]): string[] {
  if (!Array.isArray(types)) return [...fallback];
  const cleaned = uniq(
    types
      .map((t) => (typeof t === 'string' ? normalizeBookingTypeSlug(t) : ''))
      .filter(Boolean),
  );
  return cleaned.length ? cleaned : [...fallback];
}

export function mergeBookingPolicy(partial?: Partial<BookingPolicy> | null): BookingPolicy {
  if (!partial) {
    return {
      ...DEFAULT_BOOKING_POLICY,
      requiredFields: [...DEFAULT_BOOKING_POLICY.requiredFields],
      allowedBookingTypes: [...DEFAULT_BOOKING_POLICY.allowedBookingTypes],
    };
  }
  const outcome = partial.outcome ?? DEFAULT_BOOKING_POLICY.outcome;
  const vocab = vocabularyForOutcome(outcome);
  const requiredFields = Array.isArray(partial.requiredFields)
    ? uniq(partial.requiredFields.filter(Boolean) as BookingRequiredField[])
    : [...DEFAULT_BOOKING_POLICY.requiredFields];
  const discussBeforeSave = Array.isArray(partial.discussBeforeSave)
    ? uniq(partial.discussBeforeSave.filter(Boolean) as BookingDiscussGate[])
    : [...DEFAULT_BOOKING_POLICY.discussBeforeSave];

  const bookingTypeRaw =
    typeof partial.bookingType === 'string' && partial.bookingType.trim()
      ? normalizeBookingTypeSlug(partial.bookingType)
      : vocab.bookingType;
  const bookingType = bookingTypeRaw || vocab.bookingType;
  const allowedBookingTypes = sanitizeAllowed(
    partial.allowedBookingTypes,
    partial.bookingType ? [bookingType] : vocab.allowedBookingTypes,
  );
  // Ensure default type is always in the allowed list
  if (!allowedBookingTypes.includes(bookingType)) {
    allowedBookingTypes.unshift(bookingType);
  }

  const speakAs =
    typeof partial.speakAs === 'string' && partial.speakAs.trim()
      ? partial.speakAs.trim()
      : vocab.speakAs;

  const locationType: BookingLocationType =
    partial.locationType === 'showroom' ||
    partial.locationType === 'home' ||
    partial.locationType === 'online' ||
    partial.locationType === 'hotel'
      ? partial.locationType
      : vocab.locationType;

  return {
    templateId: partial.templateId ?? DEFAULT_BOOKING_POLICY.templateId,
    outcome,
    bookingType,
    speakAs,
    allowedBookingTypes,
    locationType,
    requiredFields: requiredFields.length ? requiredFields : [...DEFAULT_BOOKING_POLICY.requiredFields],
    discussBeforeSave,
    askEmail: partial.askEmail ?? DEFAULT_BOOKING_POLICY.askEmail,
    notes: typeof partial.notes === 'string' ? partial.notes : DEFAULT_BOOKING_POLICY.notes,
  };
}

export function applyBookingPolicyTemplate(
  templateId: Exclude<BookingPolicyTemplateId, 'custom'>,
): BookingPolicy {
  const t = BOOKING_POLICY_TEMPLATES[templateId];
  return mergeBookingPolicy(structuredClone(t.policy));
}

/**
 * Resolve booking_type for a save: prefer model pick if allowed, else policy default.
 * Never invent types outside allowedBookingTypes.
 */
export function resolveBookingType(
  policyInput: Partial<BookingPolicy> | null | undefined,
  requested?: string | null,
): string {
  const policy = mergeBookingPolicy(policyInput);
  const req = requested ? normalizeBookingTypeSlug(requested) : '';
  if (req && policy.allowedBookingTypes.includes(req)) return req;
  return policy.bookingType;
}

/** Default capture_demo_lead booking_type from Booking policy (legacy helper). */
export function bookingTypeForOutcome(outcome: BookingOutcome): BookingType {
  return vocabularyForOutcome(outcome).bookingType as BookingType;
}

/** Spoken confirm hint after ok:true — uses policy.speakAs, not hardcoded product words. */
export function bookingSavedConfirmMessage(
  policyInput: Partial<BookingPolicy> | null | undefined,
  opts?: { alreadyBooked?: boolean; bookingType?: string },
): string {
  const policy = mergeBookingPolicy(policyInput);
  if (opts?.alreadyBooked) {
    return 'Already saved this call. Restate the same slot. Do not say it is full. Then end_call.';
  }
  const label = policy.speakAs;
  const others = policy.allowedBookingTypes.filter((t) => t !== policy.bookingType);
  const never =
    others.length === 0 && policy.outcome === 'stay'
      ? ' NEVER say showroom visit, test drive, or demo.'
      : ` Do not call it something else (only: ${policy.allowedBookingTypes.join(', ')}).`;
  return `Saved as ${opts?.bookingType ?? policy.bookingType}. Tell the caller their ${label} is confirmed.${never}`;
}

/** Prompt block — keep compact for phone S2S trim. */
export function buildBookingPolicyPrompt(policyInput?: Partial<BookingPolicy> | null): string {
  const policy = mergeBookingPolicy(policyInput);
  const fields = policy.requiredFields.map((f) => FIELD_LABELS[f]).join('; ');
  const gates =
    policy.discussBeforeSave.length > 0
      ? policy.discussBeforeSave.map((g) => GATE_LABELS[g]).join('; ')
      : 'none — do not invent extra intake gates';
  const emailLine = policy.askEmail
    ? '- Ask for email only if still missing; read back and confirm before save.'
    : '- Never ask for email on booking. Save with email_skipped=true.';
  const notes = policy.notes.trim()
    ? `- Extra policy notes: ${policy.notes.trim()}`
    : '';

  const discussTiming =
    policy.discussBeforeSave.length > 0
      ? `- Discuss-before-save topics (${gates}) are **save gates only** — cover them in the turn(s) right before capture_demo_lead, when the caller clearly wants to book / pay / confirm.
- **Do NOT** bring up payment, advance, deposit, cancellation, or other discuss gates on location, amenity, availability, or date-clarification turns. If the caller corrects dates or says "meri baat suno", answer only that — leave gates for later.
- Unfinished discuss gates are NOT an open agenda for every reply.`
      : '';

  const typeLine = `- Save booking_type must be one of: ${policy.allowedBookingTypes.join(', ')} (default **${policy.bookingType}**). Do not invent other types.
- After save ok:true, say **${policy.speakAs}** confirmed — never use other product vocabulary (e.g. do not say showroom visit unless that is this agent's speakAs).`;

  return `## Booking policy (this agent)
- Save outcome: **${OUTCOME_LABELS[policy.outcome]}** via capture_demo_lead (or schedule_callback if they only want a later call).
- Required before capture_demo_lead: ${fields}.
- Must discuss before save: ${gates}.
${discussTiming ? `${discussTiming}\n` : ''}${typeLine}
- Never call capture_demo_lead until required fields are confirmed AND discuss-before-save topics are covered (use Product Knowledge for amounts/policies — do not invent).
- For each discuss gate, set the matching *_discussed=true flag on capture_demo_lead only after the caller acknowledged. The server rejects saves without those flags.
${emailLine}
- Never announce booked / confirmed until capture_demo_lead returns ok:true. If the tool returns an error about payment/policy, follow the hint on the **next booking turn** — do not invent a confirmation, and do not hijack a different user question to push payment.
${notes}`.trim();
}

export function buildCaptureDemoLeadToolDescription(
  policyInput: Partial<BookingPolicy> | null | undefined,
  opts?: { knownName?: string; knownPhone?: string },
): string {
  const policy = mergeBookingPolicy(policyInput);
  const knownName = opts?.knownName?.trim();
  const fieldOrder = policy.requiredFields
    .filter((f) => !(f === 'name' && knownName))
    .map((f) => f)
    .join(' → ');
  const gates =
    policy.discussBeforeSave.length > 0
      ? ` Immediately before this tool (not on every discovery turn) you MUST discuss: ${policy.discussBeforeSave.join(', ')} (from Product Knowledge). Never tack payment/advance onto location or date-correction replies.`
      : '';
  const gateFlags =
    policy.discussBeforeSave.length > 0
      ? `Set ${policy.discussBeforeSave.map((g) => `${g}_discussed=true`).join(' and ')} only after that discussion + caller ack. `
      : '';
  const email = policy.askEmail
    ? 'Confirm email before save.'
    : 'NEVER ask for email; save with email_skipped=true.';
  const nameBit = knownName
    ? `Name on file: ${knownName} — do not ask again.`
    : 'Confirm name with read-back yes/haan.';
  const outcome = OUTCOME_LABELS[policy.outcome];
  const allowed = policy.allowedBookingTypes.join(' | ');
  const typeHint = `Set booking_type to one of [${allowed}] (default ${policy.bookingType}). After ok:true say "${policy.speakAs}" confirmed — never other product labels.`;
  const stayInventoryHint =
    policy.outcome === 'stay'
      ? ` For stay bookings pass city (required) and room_name when they chose a type — server re-checks live inventory before save; if sold out you get alternatives (never invent confirmed). `
      : '';

  return (
    `Save a ${outcome} after the caller wants it.${gates} ` +
    `Collect/confirm in order: ${fieldOrder || 'preferred_time'}. ${nameBit} ${email} ` +
    `Set name_confirmed/phone_confirmed only after explicit yes/haan. ` +
    `${gateFlags}` +
    `${typeHint}` +
    `${stayInventoryHint}` +
    `NEVER use schedule_callback for visits/stays. Only call this tool when policy gates are done. ` +
    `Server rejects the save if required *_discussed flags are missing — never announce confirmed until ok:true.`
  );
}

const GATE_ARG: Record<BookingDiscussGate, string> = {
  payment: 'payment_discussed',
  cancellation: 'cancellation_discussed',
  id_proof: 'id_proof_discussed',
  budget: 'budget_discussed',
};

/** True when every discussBeforeSave gate has a matching *_discussed: true flag. */
export function missingBookingDiscussGates(
  policyInput: Partial<BookingPolicy> | null | undefined,
  flags: Record<string, unknown>,
): BookingDiscussGate[] {
  const policy = mergeBookingPolicy(policyInput);
  return policy.discussBeforeSave.filter((gate) => flags[GATE_ARG[gate]] !== true);
}

export function bookingDiscussGateRejection(missing: BookingDiscussGate[]): {
  ok: false;
  error: string;
  hint: string;
} {
  const labels = missing.map((g) => GATE_LABELS[g]).join('; ');
  const flags = missing.map((g) => `${GATE_ARG[g]}=true`).join(', ');
  return {
    ok: false,
    error: `Booking policy requires discussing first: ${missing.join(', ')}`,
    hint:
      `Do NOT say the booking is confirmed. When the caller is ready to book (not mid date/location Q&A), briefly explain from Product Knowledge: ${labels}. ` +
      `Get acknowledgment, then retry capture_demo_lead with ${flags}. If they asked something else just now, answer that first — do not force these topics into every reply.`,
  };
}

export function bookingDiscussGateToolProperties(
  policyInput: Partial<BookingPolicy> | null | undefined,
): Record<string, { type: 'boolean'; description: string }> {
  const policy = mergeBookingPolicy(policyInput);
  const out: Record<string, { type: 'boolean'; description: string }> = {};
  for (const gate of policy.discussBeforeSave) {
    out[GATE_ARG[gate]] = {
      type: 'boolean',
      description: `Set true ONLY after you discussed ${GATE_LABELS[gate]} and the caller acknowledged. Required by this agent's booking policy.`,
    };
  }
  return out;
}
