/**
 * Generate bookable slots from availability rules and paint booked vs free.
 */

import {
  addIstCalendarDays,
  getIstCalendarParts,
} from './call-time.js';
import {
  durationMinutesForBookingType,
  intervalsOverlap,
  istWallToUtcDate,
  toIstIsoDate,
  type BookingType,
} from './schedule-parse.js';

export interface AvailabilityConfig {
  /**
   * When false, appointment slot rules are not enforced (any day/time OK).
   * Used for hotel/stay agents or when Studio Calendar is turned off.
   */
  enabled: boolean;
  timezone?: string;
  openDays: number[];
  dayStartHour: number;
  dayStartMinute: number;
  dayEndHour: number;
  dayEndMinute: number;
  slotMinutes: number;
  capacityPerSlot: number;
  blockedDates: string[];
  slotMinutesByType?: Record<string, number>;
}

export const DEFAULT_AVAILABILITY: AvailabilityConfig = {
  enabled: true,
  timezone: 'Asia/Kolkata',
  openDays: [1, 2, 3, 4, 5, 6],
  dayStartHour: 10,
  dayStartMinute: 0,
  dayEndHour: 19,
  dayEndMinute: 0,
  slotMinutes: 30,
  capacityPerSlot: 1,
  blockedDates: [],
  slotMinutesByType: {},
};

/** Config when an agent has no calendar rules (or Calendar off) — no slot enforcement. */
export const DISABLED_AVAILABILITY: AvailabilityConfig = {
  ...DEFAULT_AVAILABILITY,
  enabled: false,
  openDays: [0, 1, 2, 3, 4, 5, 6],
  dayStartHour: 0,
  dayStartMinute: 0,
  dayEndHour: 23,
  dayEndMinute: 59,
  capacityPerSlot: 99,
};

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface ExistingBooking {
  id: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  name?: string;
  bookingType?: string;
  status?: string;
  callId?: string | null;
}

export interface CalendarSlot {
  start: Date;
  end: Date;
  status: 'booked' | 'free' | 'full';
  remainingCapacity: number;
  bookings: ExistingBooking[];
}

export interface MonthDaySummary {
  date: string;
  weekdayIndex: number;
  isOpen: boolean;
  bookingCount: number;
  freeSlotCount: number;
  hasAvailability: boolean;
}

function isActiveBooking(status?: string): boolean {
  const s = (status ?? 'new').toLowerCase();
  return s !== 'cancelled' && s !== 'canceled' && s !== 'no_show';
}

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

export function slotDurationFor(
  config: AvailabilityConfig,
  bookingType?: string,
): number {
  return durationMinutesForBookingType(bookingType, config.slotMinutesByType) ||
    config.slotMinutes;
}

export function isDateOpen(config: AvailabilityConfig, isoDate: string): boolean {
  if (!config.enabled) return true;
  if (config.blockedDates.includes(isoDate)) return false;
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!, 6, 30, 0));
  const cal = getIstCalendarParts(utc);
  return config.openDays.includes(cal.weekdayIndex);
}

/** Generate all slot starts for one IST calendar day. */
export function generateDaySlots(
  config: AvailabilityConfig,
  isoDate: string,
  bookingType?: string,
): { start: Date; end: Date }[] {
  if (!isDateOpen(config, isoDate)) return [];

  const [y, m, d] = isoDate.split('-').map(Number);
  const slotMin = slotDurationFor(config, bookingType);
  const startMin = minutesOfDay(config.dayStartHour, config.dayStartMinute);
  const endMin = minutesOfDay(config.dayEndHour, config.dayEndMinute);
  const slots: { start: Date; end: Date }[] = [];

  for (let t = startMin; t + slotMin <= endMin; t += slotMin) {
    const hour = Math.floor(t / 60);
    const minute = t % 60;
    const start = istWallToUtcDate(y!, m!, d!, hour, minute);
    const end = new Date(start.getTime() + slotMin * 60_000);
    slots.push({ start, end });
  }
  return slots;
}

export function paintDaySlots(
  config: AvailabilityConfig,
  isoDate: string,
  bookings: ExistingBooking[],
  bookingType?: string,
): CalendarSlot[] {
  const active = bookings.filter((b) => isActiveBooking(b.status));
  return generateDaySlots(config, isoDate, bookingType).map((slot) => {
    const overlapping = active.filter((b) =>
      intervalsOverlap(slot.start, slot.end, b.scheduledStart, b.scheduledEnd),
    );
    const remaining = Math.max(0, config.capacityPerSlot - overlapping.length);
    let status: CalendarSlot['status'] = 'free';
    if (overlapping.length > 0 && remaining > 0) status = 'booked';
    if (remaining === 0) status = 'full';
    if (overlapping.length > 0 && remaining === 0) status = 'full';
    if (overlapping.length > 0 && remaining > 0) status = 'booked';
    if (overlapping.length === 0) status = 'free';
    return {
      start: slot.start,
      end: slot.end,
      status,
      remainingCapacity: remaining,
      bookings: overlapping,
    };
  });
}

export function formatOpenHoursLabel(config: AvailabilityConfig): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = `${pad(config.dayStartHour)}:${pad(config.dayStartMinute)}`;
  const end = `${pad(config.dayEndHour)}:${pad(config.dayEndMinute)}`;
  return `${start}–${end} IST`;
}

/** e.g. "Mon–Sat" or "Sun, Mon, Wed–Fri" from openDays indices. */
export function formatOpenDaysLabel(config: AvailabilityConfig): string {
  const days = [...new Set(config.openDays)]
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => a - b);
  if (!days.length) return 'no open days';
  if (days.length === 7) return 'every day';

  const ranges: string[] = [];
  let i = 0;
  while (i < days.length) {
    const start = days[i]!;
    let end = start;
    while (i + 1 < days.length && days[i + 1] === end + 1) {
      i += 1;
      end = days[i]!;
    }
    ranges.push(
      start === end
        ? WEEKDAY_SHORT[start]!
        : end === start + 1
          ? `${WEEKDAY_SHORT[start]}, ${WEEKDAY_SHORT[end]}`
          : `${WEEKDAY_SHORT[start]}–${WEEKDAY_SHORT[end]}`,
    );
    i += 1;
  }
  return ranges.join(', ');
}

/** Human window for prompts / UI, e.g. "Mon–Sat 10:00–19:00 IST". */
export function formatBookingWindowLabel(config: AvailabilityConfig): string {
  if (!config.enabled) return 'any day (calendar off)';
  return `${formatOpenDaysLabel(config)} ${formatOpenHoursLabel(config)}`;
}

/** IST wall-clock minutes since midnight for a Date. */
export function istMinutesOfDay(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/** True when the booking interval sits fully inside open hours that day. */
export function isWithinOpenHours(
  config: AvailabilityConfig,
  start: Date,
  end: Date,
): boolean {
  if (!config.enabled) return true;
  const openStart = minutesOfDay(config.dayStartHour, config.dayStartMinute);
  const openEnd = minutesOfDay(config.dayEndHour, config.dayEndMinute);
  const startMin = istMinutesOfDay(start);
  const endMin = istMinutesOfDay(end);
  // Reject overnight / inverted; require start >= open and end <= close
  if (endMin <= startMin && end.getTime() > start.getTime()) {
    // crossed midnight in IST — not allowed for demo slots
    return false;
  }
  return startMin >= openStart && endMin <= openEnd && startMin < openEnd;
}

export function findNextFreeSlots(
  config: AvailabilityConfig,
  fromIsoDate: string,
  bookings: ExistingBooking[],
  limit = 3,
  bookingType?: string,
): CalendarSlot[] {
  const alternatives: CalendarSlot[] = [];
  let [y, m, d] = fromIsoDate.split('-').map(Number);
  const now = Date.now();

  for (let i = 0; i < 14 && alternatives.length < limit; i++) {
    const iso =
      i === 0
        ? fromIsoDate
        : (() => {
            const next = addIstCalendarDays(y!, m!, d!, 1);
            [y, m, d] = next.isoDate.split('-').map(Number);
            return next.isoDate;
          })();

    if (!isDateOpen(config, iso)) continue;
    const free = paintDaySlots(config, iso, bookings, bookingType).filter(
      (s) => s.status === 'free' && s.start.getTime() >= now,
    );
    for (const s of free) {
      if (alternatives.length >= limit) break;
      alternatives.push(s);
    }
  }
  return alternatives;
}

export function isSlotAvailable(
  config: AvailabilityConfig,
  start: Date,
  end: Date,
  bookings: ExistingBooking[],
  bookingType?: string,
): { ok: true } | { ok: false; reason: string; alternatives: CalendarSlot[] } {
  if (!config.enabled) return { ok: true };

  const isoDate = toIstIsoDate(start);
  const hoursLabel = formatOpenHoursLabel(config);
  const daysLabel = formatOpenDaysLabel(config);
  const windowLabel = formatBookingWindowLabel(config);

  if (!isDateOpen(config, isoDate)) {
    return {
      ok: false,
      reason: `That day is closed. Bookings are ${daysLabel} ${hoursLabel} only.`,
      alternatives: findNextFreeSlots(config, isoDate, bookings, 3, bookingType),
    };
  }

  if (!isWithinOpenHours(config, start, end)) {
    return {
      ok: false,
      reason: `That time is outside booking hours (${windowLabel}). We cannot book before ${String(config.dayStartHour).padStart(2, '0')}:${String(config.dayStartMinute).padStart(2, '0')} or at/after ${String(config.dayEndHour).padStart(2, '0')}:${String(config.dayEndMinute).padStart(2, '0')} IST.`,
      alternatives: findNextFreeSlots(config, isoDate, bookings, 3, bookingType),
    };
  }

  const active = bookings.filter((b) => isActiveBooking(b.status));
  const overlapping = active.filter((b) =>
    intervalsOverlap(start, end, b.scheduledStart, b.scheduledEnd),
  );
  if (overlapping.length >= config.capacityPerSlot) {
    return {
      ok: false,
      reason: 'That time slot is already full',
      alternatives: findNextFreeSlots(config, isoDate, bookings, 3, bookingType),
    };
  }
  return { ok: true };
}

export function buildMonthSummary(
  config: AvailabilityConfig,
  year: number,
  month: number,
  bookings: ExistingBooking[],
  bookingType?: string,
): MonthDaySummary[] {
  const first = istWallToUtcDate(year, month, 1, 12, 0);
  const cal = getIstCalendarParts(first);
  // days in month
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: MonthDaySummary[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayBookings = bookings.filter(
      (b) => isActiveBooking(b.status) && toIstIsoDate(b.scheduledStart) === isoDate,
    );
    const slots = paintDaySlots(config, isoDate, bookings, bookingType);
    const freeSlotCount = slots.filter((s) => s.status === 'free').length;
    const open = isDateOpen(config, isoDate);
    const weekdayUtc = new Date(Date.UTC(year, month - 1, day, 6, 30, 0));
    const weekdayIndex = getIstCalendarParts(weekdayUtc).weekdayIndex;
    days.push({
      date: isoDate,
      weekdayIndex,
      isOpen: open,
      bookingCount: dayBookings.length,
      freeSlotCount,
      hasAvailability: open && freeSlotCount > 0,
    });
  }
  void cal;
  return days;
}

export function normalizeAvailabilityConfig(
  raw: Partial<AvailabilityConfig> | null | undefined,
): AvailabilityConfig {
  const enabled = raw?.enabled !== false;
  return {
    ...DEFAULT_AVAILABILITY,
    ...raw,
    enabled,
    openDays: Array.isArray(raw?.openDays) ? raw!.openDays : DEFAULT_AVAILABILITY.openDays,
    blockedDates: Array.isArray(raw?.blockedDates)
      ? raw!.blockedDates
      : DEFAULT_AVAILABILITY.blockedDates,
    slotMinutesByType:
      raw?.slotMinutesByType && typeof raw.slotMinutesByType === 'object'
        ? raw.slotMinutesByType
        : {},
  };
}

export type { BookingType };
