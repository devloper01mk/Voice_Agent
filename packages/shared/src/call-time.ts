/**
 * IST (Asia/Kolkata) time-of-day helpers for call greetings and relative dates.
 * Prevents mirroring "Good morning" when it is afternoon/evening, and helps the
 * LLM resolve aaj/kal/parso to concrete calendar dates for confirmation.
 */

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export interface IstNowParts {
  dayPart: DayPart;
  /** Preferred English spoken greeting for this day part. */
  greetingEn: string;
  /** Preferred Hinglish/Hindi opener (Namaste is always safe). */
  greetingHi: string;
  /** e.g. "4:33 PM IST" */
  clockLabel: string;
  /** e.g. "Friday, 17 July 2026" */
  dateLabel: string;
  /** ISO calendar date in IST, e.g. "2026-07-17" */
  isoDate: string;
  /** Weekday name in English, e.g. "Friday" */
  weekday: string;
  /** Hour 0–23 in IST */
  hour: number;
  /** Minute 0–59 in IST */
  minute: number;
}

const IST = 'Asia/Kolkata';

const TIME_GREETING =
  /\b(good\s*morning|good\s*afternoon|good\s*evening|good\s*night|shubh\s*prabhat|suprabhat|शुभ\s*प्रभात)\b/i;

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function istPartsFromDate(now: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { hour, minute };
}

/** Calendar Y/M/D + weekday in Asia/Kolkata for the given instant. */
export function getIstCalendarParts(now: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  weekdayIndex: number;
  weekday: string;
  isoDate: string;
  dateLabel: string;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '0');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? '1');
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';

  const weekdayIndex = (() => {
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return map[weekdayShort] ?? 0;
  })();

  const weekday = WEEKDAYS[weekdayIndex]!;
  const monthName = MONTHS[month - 1]!;
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const dateLabel = `${weekday}, ${day} ${monthName} ${year}`;

  return { year, month, day, weekdayIndex, weekday, isoDate, dateLabel };
}

/** Add calendar days to an IST Y-M-D and return label/iso (handles month rollover). */
export function addIstCalendarDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { isoDate: string; dateLabel: string; weekday: string } {
  // Noon UTC avoids DST edge cases; IST has no DST. Use Date.UTC for calendar math.
  const utc = new Date(Date.UTC(year, month - 1, day + deltaDays, 6, 30, 0));
  const cal = getIstCalendarParts(utc);
  return { isoDate: cal.isoDate, dateLabel: cal.dateLabel, weekday: cal.weekday };
}

/** Days from Monday within a Monday–Sunday Indian week (Mon=0 … Sun=6). */
export function daysFromMonday(weekdayIndex: number): number {
  return (weekdayIndex + 6) % 7;
}

export interface IstResolvedDay {
  year: number;
  month: number;
  day: number;
  weekdayIndex: number;
  weekday: string;
  isoDate: string;
  dateLabel: string;
}

/**
 * Resolve a weekday inside an IST Monday-start week.
 * weekOffset 0 = this week, 1 = next week, 2 = next-to-next week.
 * targetWeekdayIndex: 0=Sunday … 6=Saturday (same as getIstCalendarParts).
 */
export function resolveIstWeekdayInWeek(
  now: Date,
  weekOffset: number,
  targetWeekdayIndex: number,
): IstResolvedDay {
  const cal = getIstCalendarParts(now);
  const delta =
    -daysFromMonday(cal.weekdayIndex) + weekOffset * 7 + daysFromMonday(targetWeekdayIndex);
  const utc = new Date(Date.UTC(cal.year, cal.month - 1, cal.day + delta, 6, 30, 0));
  return getIstCalendarParts(utc);
}

/** Monday and Sunday labels for an IST week offset (0=this, 1=next, 2=next-to-next). */
export function istWeekBounds(
  now: Date,
  weekOffset: number,
): { monday: IstResolvedDay; sunday: IstResolvedDay } {
  return {
    monday: resolveIstWeekdayInWeek(now, weekOffset, 1),
    sunday: resolveIstWeekdayInWeek(now, weekOffset, 0),
  };
}

/** Day-part buckets (IST): morning until noon, afternoon 12–2:59, evening from 3 PM. */
export function dayPartFromHour(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 15) return 'afternoon';
  if (hour >= 15 && hour <= 20) return 'evening';
  return 'night';
}

export function greetingForDayPart(dayPart: DayPart): { greetingEn: string; greetingHi: string } {
  switch (dayPart) {
    case 'morning':
      return { greetingEn: 'Good morning', greetingHi: 'Namaste' };
    case 'afternoon':
      return { greetingEn: 'Good afternoon', greetingHi: 'Namaste' };
    case 'evening':
    case 'night':
      // Avoid "good night" as a call opener.
      return { greetingEn: 'Good evening', greetingHi: 'Namaste' };
  }
}

function formatClockLabel(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  // Colon-free so prompts/system notes never teach TTS to say "colon".
  if (minute === 0) return `${h12} ${period} IST`;
  const mm = String(minute).padStart(2, '0');
  return `${h12} ${mm} ${period} IST`;
}

/** Current (or injected) IST clock + preferred greetings + calendar date. */
export function getIstNowParts(now: Date = new Date()): IstNowParts {
  const { hour, minute } = istPartsFromDate(now);
  const dayPart = dayPartFromHour(hour);
  const { greetingEn, greetingHi } = greetingForDayPart(dayPart);
  const cal = getIstCalendarParts(now);
  return {
    dayPart,
    greetingEn,
    greetingHi,
    clockLabel: formatClockLabel(hour, minute),
    dateLabel: cal.dateLabel,
    isoDate: cal.isoDate,
    weekday: cal.weekday,
    hour,
    minute,
  };
}

/** True when the caller used a time-of-day greeting. */
export function isTimeOfDayGreeting(text: string): boolean {
  const t = text.normalize('NFC').trim();
  if (!t) return false;
  return TIME_GREETING.test(t);
}

/**
 * Relative-date resolution + scheduling validation rules for the LLM.
 * Concrete aaj/kal/parso and week mappings are computed from `now` (IST Monday–Sunday weeks).
 */
export function buildRelativeDateRulesPrompt(now: Date = new Date()): string {
  const cal = getIstCalendarParts(now);
  const aaj = addIstCalendarDays(cal.year, cal.month, cal.day, 0);
  const kal = addIstCalendarDays(cal.year, cal.month, cal.day, 1);
  const parso = addIstCalendarDays(cal.year, cal.month, cal.day, 2);
  const yesterday = addIstCalendarDays(cal.year, cal.month, cal.day, -1);

  const thisWeek = istWeekBounds(now, 0);
  const nextWeek = istWeekBounds(now, 1);
  const next2Week = istWeekBounds(now, 2);
  const nextTue = resolveIstWeekdayInWeek(now, 1, 2);
  const next2Tue = resolveIstWeekdayInWeek(now, 2, 2);
  const next2Thu = resolveIstWeekdayInWeek(now, 2, 4);

  return `### Relative dates & scheduling (IST — mandatory)
- Today is **${aaj.dateLabel}** (\`${aaj.isoDate}\`). Resolve relative words against this date only.
- **Indian calendar weeks are Monday–Sunday IST** (not Sunday-start). Never invent dates; use the mappings below. Never shift a whole date range by one day.
- Common mappings for **future scheduling** (appointment / callback / preferred_time / stay dates):
  - **aaj / today** → ${aaj.dateLabel}
  - **kal / tomorrow** → ${kal.dateLabel}
  - **parso / day after tomorrow** → ${parso.dateLabel}
  - **yesterday / kal** (past sense) → ${yesterday.dateLabel} — only if caller is talking about a past event, not booking
- **Week mappings (computed for this call — use these exact dates):**
  - **This week** (Mon–Sun): ${thisWeek.monday.dateLabel} → ${thisWeek.sunday.dateLabel}
  - **Next week** (Mon–Sun): ${nextWeek.monday.dateLabel} → ${nextWeek.sunday.dateLabel}
  - **Next to next week** (Mon–Sun): ${next2Week.monday.dateLabel} → ${next2Week.sunday.dateLabel}
  - **next week Tuesday** → ${nextTue.dateLabel} (\`${nextTue.isoDate}\`)
  - **next to next week Tuesday** → ${next2Tue.dateLabel} (\`${next2Tue.isoDate}\`)
  - **next to next week Tuesday se Thursday** → confirm **${next2Tue.dateLabel}** through **${next2Thu.dateLabel}** (not the day after)
- Same rules for Hinglish: "agle hafte" = next week; "agle agle hafte" / "next to next" = next to next week.
- Weekday alone ("Monday", "somvaar") **without** next/next-to-next week: pick the **next** occurrence of that weekday on/after today (not last week), unless they clearly mean a past event.
- **Booking hours:** follow business hours from Product Knowledge / Booking policy notes, and the save tool's hours/full-slot errors. If a requested time is outside them, politely say so and offer 2–3 valid times. Only save after they pick one.
  - "Subah" without a clock time → default to **10 AM** (not 8 or 9). "Shaam" without a clock → default to **5 PM** (not 8 PM).
- **Always confirm** the resolved absolute date/time before saving preferred_time or calling schedule_callback / capture_demo_lead.
  - Example: caller says "parso teen baje" → ask "19 July ko 3 baje — sahi hai?" (use the real resolved date).
  - Example: caller says "next to next week Tuesday" → ask "${next2Tue.dateLabel} — sahi hai?" (use the mapped date above).
  - English call: "That's 19 July at 3 PM — is that correct?"
- **Live lookup tools:** when a live lookup tool takes dates, resolve them silently into its args — do not audio-confirm dates before the tool returns.
- **Past datetime validation (scheduling):** if the resolved demo/callback time is already in the past relative to Now above, do NOT save it. Say it has passed and ask for a future time.
- Ambiguous "kal" (past vs future): for scheduling assume **tomorrow**; if context is historical, treat as yesterday and confirm.
- Speak confirmed dates naturally in the active call language (Hinglish: "19 July" / "unnees July"; English: "July 19" / "the 19th of July"). Times still follow language rules ("teen baje" vs "three o'clock" / "3 PM").
- **Never write clock times with a colon when speaking** (no "1:00 PM", no saying "colon"). English: "1 PM", "one thirty PM", "twelve PM". Hinglish: "ek baje", "derh baje", "barah baje".
- If capture_demo_lead returns an error about hours/full slot with alternatives, read those alternatives aloud and ask which one works — do not insist on the closed time.`;
}

/** Static prompt block injected at call start. */
export function buildCallTimeContextPrompt(now: Date = new Date()): string {
  const p = getIstNowParts(now);
  return `## Call time (IST)
- Now: **${p.dateLabel}**, **${p.clockLabel}** (${p.dayPart}).
- Prefer time greeting: **${p.greetingEn}** / **${p.greetingHi}**.
- Buckets: Good morning until 12 PM; Good afternoon from 12 PM until 3 PM; Good evening from 3 PM onward (use Good evening at night too — never Good night as opener).
- If the caller says "Good morning/afternoon/evening" that does **not** match IST right now, do **not** mirror them — reply with **${p.greetingEn}** (or Namaste), then continue. Do not lecture them about the time.

${buildRelativeDateRulesPrompt(now)}`;
}

/** Per-turn system note when caller used a time greeting. */
export function buildTimeGreetingSystemNote(now: Date = new Date()): string {
  const p = getIstNowParts(now);
  return (
    `[SYSTEM: Caller used a time greeting. Current IST is ${p.dayPart} (~${p.clockLabel}) on ${p.dateLabel}. ` +
    `Reply with ${p.greetingEn} (or Namaste) — do NOT mirror a wrong time-of-day greeting ` +
    `(e.g. do not say Good morning if it is afternoon/evening).]`
  );
}
