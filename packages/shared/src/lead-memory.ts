/**
 * Per-agent lead memory retention — contact identity vs open bookings vs consumed history.
 * Product-agnostic; used by telephony + Simulator 2.0.
 */

import type { SkillsConfig } from './skills-types.js';

export const LEAD_MEMORY_RETENTION_PRESETS = [
  { hours: 0, label: 'Off (no memory)' },
  { hours: 24, label: 'Last 24 hours' },
  { hours: 48, label: 'Last 48 hours' },
  { hours: 168, label: 'Last 7 days' },
  { hours: 720, label: 'Last 30 days' },
] as const;

export type LeadMemoryRetentionHours = (typeof LEAD_MEMORY_RETENTION_PRESETS)[number]['hours'];

export const DEFAULT_LEAD_MEMORY_RETENTION_HOURS: LeadMemoryRetentionHours = 48;

export function normalizeLeadMemoryRetentionHours(raw: unknown): LeadMemoryRetentionHours {
  const n = typeof raw === 'number' ? raw : Number(raw);
  const allowed = LEAD_MEMORY_RETENTION_PRESETS.map((p) => p.hours);
  if (allowed.includes(n as LeadMemoryRetentionHours)) return n as LeadMemoryRetentionHours;
  return DEFAULT_LEAD_MEMORY_RETENTION_HOURS;
}

export function getLeadMemoryRetentionHours(
  skills?: SkillsConfig | null,
): LeadMemoryRetentionHours {
  return normalizeLeadMemoryRetentionHours(skills?.runtime?.leadMemoryRetentionHours);
}

/** Soft TTL cutoff; null when retention is Off. */
export function leadMemoryCutoffDate(
  retentionHours: number,
  now = new Date(),
): Date | null {
  if (!retentionHours || retentionHours <= 0) return null;
  return new Date(now.getTime() - retentionHours * 3_600_000);
}

export function isWithinLeadMemoryWindow(
  activityAt: Date | string | null | undefined,
  retentionHours: number,
  now = new Date(),
): boolean {
  if (!retentionHours || retentionHours <= 0) return false;
  if (!activityAt) return false;
  const t = typeof activityAt === 'string' ? new Date(activityAt) : activityAt;
  if (Number.isNaN(t.getTime())) return false;
  const cutoff = leadMemoryCutoffDate(retentionHours, now);
  if (!cutoff) return false;
  return t.getTime() >= cutoff.getTime();
}

export type LeadMemoryLeadLike = {
  status?: string | null;
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  preferredTime?: string | null;
  bookingType?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

/** Used / finished / cancelled — do not volunteer unless caller recalls. */
export function isConsumedLead(lead: LeadMemoryLeadLike, now = new Date()): boolean {
  const status = (lead.status ?? '').toLowerCase();
  if (
    status === 'completed' ||
    status === 'cancelled' ||
    status === 'canceled' ||
    status === 'no_show'
  ) {
    return true;
  }
  const endRaw = lead.scheduledEnd ?? lead.scheduledStart;
  if (endRaw) {
    const end = typeof endRaw === 'string' ? new Date(endRaw) : endRaw;
    if (!Number.isNaN(end.getTime()) && end.getTime() < now.getTime()) return true;
  }
  return false;
}

/** Open / upcoming — may reference briefly in prompt. */
export function isOpenLead(lead: LeadMemoryLeadLike, now = new Date()): boolean {
  const status = (lead.status ?? '').toLowerCase();
  if (
    status === 'completed' ||
    status === 'cancelled' ||
    status === 'canceled' ||
    status === 'no_show'
  ) {
    return false;
  }
  if (isConsumedLead(lead, now)) return false;
  return (
    status === 'new' ||
    status === 'confirmed' ||
    status === 'pending' ||
    !status
  );
}

export function formatOpenBookingSummary(lead: LeadMemoryLeadLike): string {
  const type = (lead.bookingType ?? 'booking').replace(/_/g, ' ');
  let when = lead.preferredTime?.trim() || 'time TBD';
  if (lead.scheduledStart) {
    try {
      when = new Date(lead.scheduledStart).toISOString();
    } catch {
      /* keep preferred */
    }
  }
  return `${type} · ${when} · status ${lead.status ?? 'new'}`;
}

export function buildLeadMemoryRulesPrompt(retentionHours: number): string {
  if (!retentionHours || retentionHours <= 0) {
    return `## Lead memory
- Memory retention is **Off** for this agent. Treat the caller as new: collect identity as needed. Do not claim prior bookings from memory.`;
  }
  const label =
    LEAD_MEMORY_RETENTION_PRESETS.find((p) => p.hours === retentionHours)?.label ??
    `${retentionHours} hours`;
  return `## Lead memory (retention: ${label})
- Contact identity in this window may be known — do not re-ask name/phone already on file.
- You may briefly reference an **open / upcoming** booking listed below (if any).
- **Never volunteer** past, completed, cancelled, or already-used bookings ("last week aapne book kiya tha").
- Only if the caller clearly recalls prior talk/booking (e.g. pehle bhi baat hui, maine book kiya tha, last time) may you acknowledge that history in **one short line**, then continue helping.
- Otherwise run a normal consultative sales flow (discover → features → quote on ask → close on intent).`;
}

export function buildOpenBookingPromptLine(summary?: string | null): string {
  const s = summary?.trim();
  if (!s) return '';
  return `## Open booking on file
- ${s}
- You may confirm or help with this open booking if relevant. Do not invent other past bookings.`;
}

/** Caller is referencing a prior conversation / booking. */
export function isCallerPriorRecallCue(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /\b(pehle\s+bhi|pehle\s+baat|pahle\s+bhi|last\s+time|last\s+call|pehle\s+call|earlier\s+(?:call|also)|already\s+(?:booked|spoke|talked)|maine\s+(?:pehle\s+)?book|hum\s+ne\s+book|aap\s+se\s+(?:pehle|baat)|phir\s+se\s+(?:call|baat)|dobara\s+call|again\s+(?:calling|called)|we\s+(?:already\s+)?(?:spoke|booked)|previously\s+booked)\b|पहले\s*भी|पिछली\s*बार|पहले\s*बात|बुक\s*किया\s*था/i.test(
      t,
    )
  );
}

export function buildPriorRecallSystemNote(): string {
  return (
    '[SYSTEM: Caller recalled a prior conversation or booking. You MAY acknowledge past history in one short line ' +
    '(if known). Do not dump a full old booking list. Then help with their current ask.]'
  );
}
