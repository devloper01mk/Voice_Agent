/**
 * Parse spoken / free-text preferred times into concrete IST Date ranges.
 * Used when saving leads/callbacks so the month calendar and Google sync work.
 */

import { addIstCalendarDays, getIstCalendarParts, getIstNowParts } from './call-time.js';

export type BookingType =
  | 'demo'
  | 'test_drive'
  | 'simulator'
  | 'showroom_visit'
  | 'stay';

export const DEFAULT_BOOKING_DURATIONS_MIN: Record<BookingType, number> = {
  demo: 30,
  test_drive: 45,
  simulator: 60,
  showroom_visit: 30,
  /** Check-in / stay hold window on the calendar (not full length of stay). */
  stay: 60,
};

export interface ParsedSchedule {
  scheduledStart: Date;
  scheduledEnd: Date;
  /** Normalized display string */
  label: string;
  /** True when we had to guess day-part or hour defaults */
  approximate: boolean;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Build a UTC Date for an IST wall-clock Y-M-D H:M. */
export function istWallToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // IST = UTC+05:30 → UTC = IST - 5:30
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - IST_OFFSET_MS);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatIstLabel(d: Date): string {
  const cal = getIstCalendarParts(d);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '12';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value ?? 'AM';
  return `${cal.dateLabel} ${hour}:${minute} ${dayPeriod} IST`;
}

function defaultHourForDayPart(part: string): number {
  // Align with booking hours 10:00–19:00 IST (never default outside that window).
  if (/morn|subah|prabhat|सुबह/i.test(part)) return 10;
  if (/after|dopahar|دوپہر|दोपहर/i.test(part)) return 14;
  if (/even|shaam|शाम/i.test(part)) return 17;
  if (/night|raat|रात/i.test(part)) return 18; // last in-hours default, not 19:00 close
  return 11;
}

function parseClockHourMinute(text: string): { hour: number; minute: number; found: boolean } {
  const t = text.toLowerCase().normalize('NFC');

  // 15:30 / 3:30 pm / 3pm / 15.30
  const colon = t.match(/\b(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?|am|pm)?\b/i);
  if (colon) {
    let hour = Number(colon[1]);
    const minute = Number(colon[2]);
    const mer = colon[3]?.replace(/\./g, '').toLowerCase();
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute, found: true };
    }
  }

  const ampm = t.match(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/i);
  if (ampm) {
    let hour = Number(ampm[1]);
    const mer = ampm[2].replace(/\./g, '').toLowerCase();
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) return { hour, minute: 0, found: true };
  }

  // "3 baje" / "teen baje" / "15 baje"
  const bajeNum = t.match(/\b(\d{1,2})\s*(?:[:.](\d{2}))?\s*baj(?:e|ey)?\b/i);
  if (bajeNum) {
    let hour = Number(bajeNum[1]);
    const minute = bajeNum[2] ? Number(bajeNum[2]) : 0;
    // Spoken 1–7 without am/pm: prefer afternoon/evening for sales (1–7 → 13–19)
    if (hour >= 1 && hour <= 7 && !/\b(a\.?m\.?|am|subah|morning)\b/i.test(t)) {
      hour += 12;
    }
    if (hour >= 0 && hour <= 23) return { hour, minute, found: true };
  }

  const hindiHours: Record<string, number> = {
    ek: 1,
    one: 1,
    do: 2,
    two: 2,
    teen: 3,
    three: 3,
    char: 4,
    four: 4,
    paanch: 5,
    panch: 5,
    five: 5,
    chhe: 6,
    chhah: 6,
    six: 6,
    saat: 7,
    seven: 7,
    aath: 8,
    eight: 8,
    nau: 9,
    nine: 9,
    das: 10,
    ten: 10,
    gyarah: 11,
    eleven: 11,
    barah: 12,
    twelve: 12,
  };
  for (const [word, h] of Object.entries(hindiHours)) {
    if (new RegExp(`\\b${word}\\s*baj(?:e|ey)?\\b`, 'i').test(t)) {
      let hour = h;
      if (hour >= 1 && hour <= 7 && !/\b(a\.?m\.?|am|subah|morning)\b/i.test(t)) {
        hour += 12;
      }
      return { hour, minute: 0, found: true };
    }
  }

  // Bare hour 10–19
  const bare = t.match(/\bat\s+(\d{1,2})\b/i) ?? t.match(/\b(\d{2})\s*(?:hrs?|hours?)?\b/i);
  if (bare) {
    const hour = Number(bare[1]);
    if (hour >= 8 && hour <= 21) return { hour, minute: 0, found: true };
  }

  return { hour: 11, minute: 0, found: false };
}

function resolveRelativeDay(
  text: string,
  now: Date,
): { year: number; month: number; day: number; found: boolean } {
  const t = text.toLowerCase().normalize('NFC');
  const cal = getIstCalendarParts(now);

  if (/\b(aaj|today|aj)\b/i.test(t)) {
    return { year: cal.year, month: cal.month, day: cal.day, found: true };
  }
  if (/\b(kal|tomorrow|tmrw)\b/i.test(t) && !/\byesterday\b/i.test(t)) {
    const next = addIstCalendarDays(cal.year, cal.month, cal.day, 1);
    const [y, m, d] = next.isoDate.split('-').map(Number);
    return { year: y!, month: m!, day: d!, found: true };
  }
  if (/\b(parso|day after tomorrow)\b/i.test(t)) {
    const next = addIstCalendarDays(cal.year, cal.month, cal.day, 2);
    const [y, m, d] = next.isoDate.split('-').map(Number);
    return { year: y!, month: m!, day: d!, found: true };
  }

  // ISO date
  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      found: true,
    };
  }

  // "19 July 2026" / "19 Jul" / "July 19"
  const months =
    'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
  const dmy = t.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months})(?:\\s+(20\\d{2}))?\\b`, 'i'),
  );
  if (dmy) {
    const day = Number(dmy[1]);
    const month = monthNameToNumber(dmy[2]!);
    const year = dmy[3] ? Number(dmy[3]) : cal.year;
    return { year, month, day, found: true };
  }
  const mdy = t.match(
    new RegExp(`\\b(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(20\\d{2}))?\\b`, 'i'),
  );
  if (mdy) {
    const month = monthNameToNumber(mdy[1]!);
    const day = Number(mdy[2]);
    const year = mdy[3] ? Number(mdy[3]) : cal.year;
    return { year, month, day, found: true };
  }

  // Weekday → next occurrence
  const weekdays: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    ravivar: 0,
    somvaar: 1,
    somvar: 1,
    mangalvaar: 2,
    mangalvar: 2,
    budhvaar: 3,
    budhvar: 3,
    guruvaar: 4,
    guruvar: 4,
    shukrvaar: 5,
    shukrvar: 5,
    shanivaar: 6,
    shanivar: 6,
  };
  for (const [name, idx] of Object.entries(weekdays)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(t)) {
      let delta = (idx - cal.weekdayIndex + 7) % 7;
      if (delta === 0) delta = 7; // next week if same day without "aaj"
      const next = addIstCalendarDays(cal.year, cal.month, cal.day, delta);
      const [y, m, d] = next.isoDate.split('-').map(Number);
      return { year: y!, month: m!, day: d!, found: true };
    }
  }

  return { year: cal.year, month: cal.month, day: cal.day, found: false };
}

function monthNameToNumber(name: string): number {
  const n = name.toLowerCase().slice(0, 3);
  const map: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  return map[n] ?? 1;
}

export function durationMinutesForBookingType(
  bookingType: string | undefined,
  overrides?: Record<string, number>,
): number {
  const key = (bookingType ?? 'demo') as BookingType;
  if (overrides && typeof overrides[key] === 'number') return overrides[key]!;
  return DEFAULT_BOOKING_DURATIONS_MIN[key] ?? 30;
}

/**
 * Parse preferredTime text into start/end Dates (UTC instants representing IST wall times).
 * Returns null if nothing usable could be extracted (caller should still store raw text).
 */
export function parsePreferredTime(
  raw: string,
  opts?: {
    now?: Date;
    bookingType?: string;
    durationMinutes?: number;
  },
): ParsedSchedule | null {
  const text = raw?.trim();
  if (!text) return null;

  const now = opts?.now ?? new Date();
  const duration =
    opts?.durationMinutes ?? durationMinutesForBookingType(opts?.bookingType);

  // Full ISO datetime
  const isoDt = text.match(
    /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (isoDt) {
    const start = new Date(text.includes('T') || /Z|[+-]\d/.test(text) ? text : `${text}+05:30`);
    if (!Number.isNaN(start.getTime())) {
      const end = new Date(start.getTime() + duration * 60_000);
      return {
        scheduledStart: start,
        scheduledEnd: end,
        label: formatIstLabel(start),
        approximate: false,
      };
    }
  }

  const day = resolveRelativeDay(text, now);
  let clock = parseClockHourMinute(text);
  let approximate = !day.found || !clock.found;

  if (!clock.found) {
    const partMatch = text.match(/\b(morning|afternoon|evening|night|subah|dopahar|shaam|raat)\b/i);
    if (partMatch) {
      clock = { hour: defaultHourForDayPart(partMatch[1]!), minute: 0, found: true };
      approximate = !day.found;
    }
  }

  if (!day.found && !clock.found) {
    // Last resort: tomorrow 11:00 so calendar still gets a slot; mark approximate
    const cal = getIstCalendarParts(now);
    const next = addIstCalendarDays(cal.year, cal.month, cal.day, 1);
    const [y, m, d] = next.isoDate.split('-').map(Number);
    const start = istWallToUtcDate(y!, m!, d!, 11, 0);
    const end = new Date(start.getTime() + duration * 60_000);
    return {
      scheduledStart: start,
      scheduledEnd: end,
      label: formatIstLabel(start),
      approximate: true,
    };
  }

  if (!day.found) {
    // Time only → assume next occurrence of that clock (today if still future, else tomorrow)
    const cal = getIstCalendarParts(now);
    const nowParts = getIstNowParts(now);
    let y = cal.year;
    let m = cal.month;
    let d = cal.day;
    const candidate = istWallToUtcDate(y, m, d, clock.hour, clock.minute);
    if (candidate.getTime() <= now.getTime()) {
      const next = addIstCalendarDays(y, m, d, 1);
      [y, m, d] = next.isoDate.split('-').map(Number) as [number, number, number];
    }
    void nowParts;
    const start = istWallToUtcDate(y, m, d, clock.hour, clock.minute);
    const end = new Date(start.getTime() + duration * 60_000);
    return {
      scheduledStart: start,
      scheduledEnd: end,
      label: formatIstLabel(start),
      approximate: true,
    };
  }

  const start = istWallToUtcDate(day.year, day.month, day.day, clock.hour, clock.minute);
  const end = new Date(start.getTime() + duration * 60_000);
  return {
    scheduledStart: start,
    scheduledEnd: end,
    label: formatIstLabel(start),
    approximate,
  };
}

export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

/** IST Y-M-D string for a Date. */
export function toIstIsoDate(d: Date): string {
  return getIstCalendarParts(d).isoDate;
}

export function formatSlotKey(isoDate: string, hour: number, minute: number): string {
  return `${isoDate}T${pad2(hour)}:${pad2(minute)}`;
}
