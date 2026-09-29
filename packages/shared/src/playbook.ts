/**
 * Sales playbook = *how to sell* for one agent (industry, goal, fields, discovery, do-nots).
 * Pure data: stored per agent, seeded from templates, editable in Studio. Core skills stay
 * product-agnostic; nothing industry-specific should live in code outside templates.
 */

import {
  applyBookingPolicyTemplate,
  mergeBookingPolicy,
  normalizeBookingTypeSlug,
  type BookingOutcome,
  type BookingPolicy,
  type BookingPolicyTemplateId,
} from './booking-policy.js';

export type PlaybookDateMode = 'single_slot' | 'date_range' | 'none';

export interface PlaybookField {
  key: string;
  label: string;
  required: boolean;
}

export interface PlaybookGoal {
  /** Spoken name of the close, e.g. "site visit". */
  label: string;
  /** Saved as Lead.bookingType, e.g. "site_visit". */
  slug: string;
  alternateSlugs: string[];
  dateMode: PlaybookDateMode;
  /** Free-text Lead.locationType, e.g. "site", "online", "hotel". */
  locationType: string;
}

export interface SalesPlaybook {
  templateId: string;
  industry: string;
  customerNoun: string;
  offeringNoun: string;
  goal: PlaybookGoal;
  fields: PlaybookField[];
  discoveryQuestions: string[];
  qualification: string[];
  mustNotSay: string[];
  pricingRules: string;
  handoff: string;
  extraRules: string;
}

export interface PlaybookTemplate {
  label: string;
  description: string;
  /** Booking-policy seed applied with the template (outcome + save gates). */
  booking: { template?: Exclude<BookingPolicyTemplateId, 'custom'>; outcome: BookingOutcome };
  playbook: SalesPlaybook;
}

export const PLAYBOOK_LIMITS = {
  listItems: 8,
  itemChars: 200,
  fields: 8,
  shortText: 60,
  pricingRules: 400,
  handoff: 300,
  extraRules: 600,
} as const;

export const SALES_PLAYBOOK_HEADING = '## Sales playbook';

const empty = (overrides: Partial<SalesPlaybook> & Pick<SalesPlaybook, 'templateId' | 'goal'>): SalesPlaybook => ({
  industry: 'General',
  customerNoun: 'customer',
  offeringNoun: 'offering',
  fields: [],
  discoveryQuestions: [],
  qualification: [],
  mustNotSay: [],
  pricingRules: '',
  handoff: '',
  extraRules: '',
  ...overrides,
});

export const PLAYBOOK_TEMPLATES: Record<string, PlaybookTemplate> = {
  generic: {
    label: 'Generic',
    description: 'Any product — answer from Product Knowledge, capture a lead or appointment on clear intent.',
    booking: { outcome: 'lead_only' },
    playbook: empty({
      templateId: 'generic',
      goal: { label: 'follow-up', slug: 'follow_up', alternateSlugs: [], dateMode: 'single_slot', locationType: 'online' },
    }),
  },
  crm_demo: {
    label: 'Software / SaaS demo',
    description: 'Discover the use-case, then schedule a product demo.',
    booking: { template: 'crm_demo', outcome: 'demo' },
    playbook: empty({
      templateId: 'crm_demo',
      industry: 'Software / SaaS',
      customerNoun: 'prospect',
      offeringNoun: 'plan',
      goal: { label: 'product demo', slug: 'demo', alternateSlugs: [], dateMode: 'single_slot', locationType: 'online' },
      discoveryQuestions: [
        'What do they use today for this?',
        'How big is the team that would use it?',
        'Which problem do they most want solved?',
      ],
      qualification: ['They described a need the product solves, or asked how it works in detail.'],
      mustNotSay: [
        'Discounts, trials, or custom pricing not listed in Product Knowledge',
        'Integrations or features not listed — say you will confirm them in the demo',
      ],
      pricingRules: 'Quote only plans listed in Product Knowledge.',
      handoff: 'Custom pricing or deep technical questions → offer the demo or a specialist callback.',
    }),
  },
  hotel_stay: {
    label: 'Hotel / stay booking',
    description: 'Properties and rooms — city, dates, guests; advance/payment before save.',
    booking: { template: 'hotel_stay', outcome: 'stay' },
    playbook: empty({
      templateId: 'hotel_stay',
      industry: 'Hotels / stays',
      customerNoun: 'guest',
      offeringNoun: 'property or room',
      goal: { label: 'hotel stay booking', slug: 'stay', alternateSlugs: [], dateMode: 'date_range', locationType: 'hotel' },
      discoveryQuestions: [
        'Which city or area are they planning?',
        'Which dates, and how many guests?',
        'What vibe or budget are they looking for?',
      ],
      qualification: ['They named a city and dates, or asked to reserve.'],
      mustNotSay: [
        'Room types, bed counts, or prices not returned by the live inventory result',
        'That a city has no property, based on Product Knowledge alone',
      ],
      pricingRules: 'Rates only from the live inventory result. Advance / deposit only when they are ready to book.',
      extraRules:
        'Stay dates are check-in and check-out. Vague place (landmark / area): clarify the nearest city with one short question or 2–3 choices first.',
    }),
  },
  auto_test_drive: {
    label: 'Auto showroom visit / test drive',
    description: 'Vehicles — needs and budget, then a showroom visit or test drive.',
    booking: { template: 'auto_test_drive', outcome: 'visit' },
    playbook: empty({
      templateId: 'auto_test_drive',
      industry: 'Automobiles',
      customerNoun: 'buyer',
      offeringNoun: 'car model',
      goal: {
        label: 'showroom visit or test drive',
        slug: 'showroom_visit',
        alternateSlugs: ['test_drive'],
        dateMode: 'single_slot',
        locationType: 'showroom',
      },
      discoveryQuestions: [
        'What budget range are they considering?',
        'Mostly city or highway driving, and how many in the family?',
        'Any fuel or transmission preference?',
      ],
      qualification: ['They shortlisted a model or asked to see / drive it.'],
      mustNotSay: ['On-road, EMI, discount, or exchange amounts as confirmed quotes'],
      pricingRules: 'Say whether a figure is ex-showroom or on-road only if Product Knowledge says so.',
      extraRules:
        'Specs like engine size in full words ("one litre" / "ek litre"). Brand complaints, ratings, gearbox, warranty and service questions are product help. Sound like a professional dealership advisor.',
    }),
  },
  real_estate: {
    label: 'Real estate — flats / plots',
    description: 'Budget, type and location first; then a site visit.',
    booking: { outcome: 'visit' },
    playbook: empty({
      templateId: 'real_estate',
      industry: 'Real estate',
      customerNoun: 'buyer',
      offeringNoun: 'flat or plot',
      goal: { label: 'site visit', slug: 'site_visit', alternateSlugs: [], dateMode: 'single_slot', locationType: 'site' },
      fields: [
        { key: 'budget', label: 'budget range', required: true },
        { key: 'property_type', label: 'property type (BHK / plot size)', required: true },
        { key: 'preferred_location', label: 'preferred location', required: false },
      ],
      discoveryQuestions: [
        'Is it for self-use or investment?',
        'Which BHK or plot size, and which area?',
        'What budget range, and by when do they want to buy?',
      ],
      qualification: ['Budget and property type are known, or they asked to see the project.'],
      mustNotSay: [
        'Possession dates, RERA numbers, or approvals not written in Product Knowledge',
        'Loan eligibility or EMI amounts as confirmed',
        'Price negotiations or discounts not listed',
      ],
      pricingRules:
        'Say whether an area is carpet or super built-up. Quote only listed prices; extra charges (parking, PLC, GST) only if listed.',
      handoff: 'Loan, legal, or documentation questions → offer a callback from the relationship manager.',
    }),
  },
  agri_advisory: {
    label: 'Agriculture advisory',
    description: 'Crop and location first; expert callback or field visit.',
    booking: { outcome: 'callback' },
    playbook: empty({
      templateId: 'agri_advisory',
      industry: 'Agriculture',
      customerNoun: 'farmer',
      offeringNoun: 'crop solution',
      goal: {
        label: 'expert callback',
        slug: 'expert_callback',
        alternateSlugs: ['field_visit'],
        dateMode: 'single_slot',
        locationType: 'phone',
      },
      fields: [
        { key: 'crop', label: 'crop', required: true },
        { key: 'village_district', label: 'village / district', required: true },
        { key: 'acreage', label: 'land size (acres)', required: false },
      ],
      discoveryQuestions: [
        'Which crop, and at what stage?',
        'What problem are they seeing (pest, disease, yield, soil)?',
        'Which village / district?',
      ],
      qualification: ['They described a crop problem or asked for product advice.'],
      mustNotSay: [
        'A pesticide or fertilizer dose that is not in Product Knowledge',
        'Guaranteed yield or results',
        'A disease diagnosis as certain — suggest the expert confirm it',
      ],
      handoff: 'Pest or disease emergencies → expert callback the same day.',
    }),
  },
};

function cleanText(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => cleanText(x, PLAYBOOK_LIMITS.itemChars))
    .filter(Boolean)
    .slice(0, PLAYBOOK_LIMITS.listItems);
}

function cleanSlug(raw: unknown): string {
  return typeof raw === 'string' ? normalizeBookingTypeSlug(raw).slice(0, 32) : '';
}

function cleanFields(raw: unknown): PlaybookField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PlaybookField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Partial<PlaybookField>;
    const label = cleanText(f.label, PLAYBOOK_LIMITS.shortText);
    const key = cleanSlug(f.key) || cleanSlug(label);
    if (!label || !/^[a-z]/.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, required: f.required === true });
    if (out.length >= PLAYBOOK_LIMITS.fields) break;
  }
  return out;
}

/** Validate / cap untrusted playbook JSON. Returns null when there is no usable goal. */
export function normalizePlaybook(raw: unknown): SalesPlaybook | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<SalesPlaybook> & { goal?: Partial<PlaybookGoal> };
  const goalLabel = cleanText(p.goal?.label, PLAYBOOK_LIMITS.shortText);
  const goalSlug = cleanSlug(p.goal?.slug) || cleanSlug(goalLabel);
  if (!goalLabel || !goalSlug) return null;
  const dateMode: PlaybookDateMode =
    p.goal?.dateMode === 'date_range' || p.goal?.dateMode === 'none' ? p.goal.dateMode : 'single_slot';
  return {
    templateId: cleanSlug(p.templateId) || 'custom',
    industry: cleanText(p.industry, PLAYBOOK_LIMITS.shortText) || 'General',
    customerNoun: cleanText(p.customerNoun, PLAYBOOK_LIMITS.shortText) || 'customer',
    offeringNoun: cleanText(p.offeringNoun, PLAYBOOK_LIMITS.shortText) || 'offering',
    goal: {
      label: goalLabel,
      slug: goalSlug,
      alternateSlugs: [...new Set((p.goal?.alternateSlugs ?? []).map(cleanSlug).filter(Boolean))]
        .filter((s) => s !== goalSlug)
        .slice(0, 4),
      dateMode,
      locationType: cleanSlug(p.goal?.locationType) || 'online',
    },
    fields: cleanFields(p.fields),
    discoveryQuestions: cleanList(p.discoveryQuestions),
    qualification: cleanList(p.qualification),
    mustNotSay: cleanList(p.mustNotSay),
    pricingRules: cleanText(p.pricingRules, PLAYBOOK_LIMITS.pricingRules),
    handoff: cleanText(p.handoff, PLAYBOOK_LIMITS.handoff),
    extraRules: cleanText(p.extraRules, PLAYBOOK_LIMITS.extraRules),
  };
}

export function getPlaybookTemplate(id?: string | null): PlaybookTemplate {
  return (id && PLAYBOOK_TEMPLATES[id]) || PLAYBOOK_TEMPLATES.generic!;
}

function templateIdForBooking(policy: BookingPolicy): string {
  if (policy.outcome === 'stay') return 'hotel_stay';
  if (policy.outcome === 'visit' && policy.templateId === 'auto_test_drive') return 'auto_test_drive';
  if (policy.outcome === 'demo' && policy.templateId === 'crm_demo') return 'crm_demo';
  return 'generic';
}

/**
 * Stored playbook wins. Without one, derive from Booking policy: selling text from the
 * matching template, goal from the policy's own vocabulary (so existing agents keep
 * exactly the labels they have today).
 */
export function resolvePlaybook(
  stored: unknown,
  bookingInput?: Partial<BookingPolicy> | null,
): SalesPlaybook {
  const normalized = normalizePlaybook(stored);
  if (normalized) return normalized;
  const policy = mergeBookingPolicy(bookingInput);
  const template = getPlaybookTemplate(templateIdForBooking(policy)).playbook;
  return {
    ...structuredClone(template),
    goal: {
      label: policy.speakAs,
      slug: policy.bookingType,
      alternateSlugs: policy.allowedBookingTypes.filter((t) => t !== policy.bookingType),
      dateMode: template.goal.dateMode,
      locationType: policy.locationType,
    },
  };
}

/** Playbook goal + fields override Booking-policy vocabulary; save gates stay on the policy. */
export function applyPlaybookToBooking(
  bookingInput: Partial<BookingPolicy> | null | undefined,
  playbook: SalesPlaybook,
): BookingPolicy {
  return mergeBookingPolicy({
    ...mergeBookingPolicy(bookingInput),
    speakAs: playbook.goal.label,
    bookingType: playbook.goal.slug,
    allowedBookingTypes: [playbook.goal.slug, ...playbook.goal.alternateSlugs],
    locationType: playbook.goal.locationType,
    customFields: playbook.fields,
  });
}

/** Effective skills for runtime: only a stored playbook changes the booking policy. */
export function applyPlaybookToSkills<T extends { booking?: BookingPolicy }>(skills: T, stored: unknown): T {
  const normalized = normalizePlaybook(stored);
  if (!normalized) return skills;
  return { ...skills, booking: applyPlaybookToBooking(skills.booking, normalized) };
}

/** Template → playbook + booking policy seed for Studio "Start from template". */
export function applyPlaybookTemplate(
  id: string,
  currentBooking?: Partial<BookingPolicy> | null,
): { playbook: SalesPlaybook; booking: BookingPolicy } {
  const t = getPlaybookTemplate(id);
  const booking = t.booking.template
    ? applyBookingPolicyTemplate(t.booking.template)
    : mergeBookingPolicy({ ...mergeBookingPolicy(currentBooking), templateId: 'custom', outcome: t.booking.outcome });
  const playbook = structuredClone(t.playbook);
  return { playbook, booking: applyPlaybookToBooking(booking, playbook) };
}

const DATE_MODE_LINES: Record<PlaybookDateMode, string> = {
  single_slot: 'Needs one date/time — confirm it with the explicit calendar date and month name.',
  date_range:
    'Needs a start AND end date — confirm both with explicit calendar dates and month names, and keep them one coherent range (same month unless it clearly crosses months).',
  none: 'No date or time is needed for this goal.',
};

export function buildPlaybookPrompt(playbook: SalesPlaybook): string {
  const p = playbook;
  const lines = [
    `${SALES_PLAYBOOK_HEADING} (${p.industry})`,
    `- You help ${p.customerNoun}s choose the right ${p.offeringNoun}. The close is a **${p.goal.label}** — offer it only when they are ready, never early.`,
    `- ${DATE_MODE_LINES[p.goal.dateMode]}`,
    p.discoveryQuestions.length
      ? `- Discovery ideas (meanings, ask at most one per turn, only when useful): ${p.discoveryQuestions.join(' / ')}`
      : '',
    p.qualification.length ? `- Offer the ${p.goal.label} when: ${p.qualification.join(' ')}` : '',
    p.pricingRules ? `- Pricing: ${p.pricingRules}` : '',
    p.mustNotSay.length ? `- Never say or promise: ${p.mustNotSay.join('; ')}.` : '',
    p.handoff ? `- Handoff: ${p.handoff}` : '',
    p.extraRules ? `- ${p.extraRules}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
