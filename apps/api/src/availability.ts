import {
  DEFAULT_AVAILABILITY,
  DISABLED_AVAILABILITY,
  normalizeAvailabilityConfig,
  parsePreferredTime,
  type AvailabilityConfig,
  type ExistingBooking,
} from '@vsa/shared';
import { prisma } from './db.js';

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function getAvailabilityConfig(agentId: string): Promise<AvailabilityConfig> {
  const row = await prisma.availabilityRules.findUnique({ where: { agentId } });
  // No Studio calendar saved → do not enforce showroom Mon–Sat defaults (hotel-friendly).
  if (!row) return { ...DISABLED_AVAILABILITY };

  return normalizeAvailabilityConfig({
    enabled: row.enabled,
    timezone: row.timezone,
    openDays: parseJson<number[]>(row.openDays, DEFAULT_AVAILABILITY.openDays),
    dayStartHour: row.dayStartHour,
    dayStartMinute: row.dayStartMinute,
    dayEndHour: row.dayEndHour,
    dayEndMinute: row.dayEndMinute,
    slotMinutes: row.slotMinutes,
    capacityPerSlot: row.capacityPerSlot,
    blockedDates: parseJson<string[]>(row.blockedDates, []),
    slotMinutesByType: parseJson<Record<string, number>>(row.slotMinutesByType, {}),
  });
}

/** Fill scheduledStart/End for older leads that only have free-text preferredTime. */
export async function backfillLeadSchedules(agentId: string): Promise<number> {
  const pending = await prisma.lead.findMany({
    where: {
      agentId,
      scheduledStart: null,
      status: { notIn: ['cancelled', 'canceled', 'no_show'] },
    },
    take: 100,
  });
  let updated = 0;
  for (const lead of pending) {
    const parsed = parsePreferredTime(lead.preferredTime, {
      bookingType: lead.bookingType,
      now: lead.createdAt,
    });
    if (!parsed) continue;
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        scheduledStart: parsed.scheduledStart,
        scheduledEnd: parsed.scheduledEnd,
        preferredTimeRaw: lead.preferredTimeRaw || lead.preferredTime,
      },
    });
    updated += 1;
  }
  return updated;
}

export async function loadActiveBookings(
  agentId: string,
  from: Date,
  to: Date,
): Promise<ExistingBooking[]> {
  await backfillLeadSchedules(agentId);

  const [leads, callbacks] = await Promise.all([
    prisma.lead.findMany({
      where: {
        agentId,
        scheduledStart: { gte: from, lt: to },
        status: { notIn: ['cancelled', 'canceled', 'no_show'] },
      },
      select: {
        id: true,
        name: true,
        bookingType: true,
        status: true,
        scheduledStart: true,
        scheduledEnd: true,
        callId: true,
      },
    }),
    prisma.callback.findMany({
      where: {
        agentId,
        scheduledAt: { gte: from, lt: to },
        status: { notIn: ['cancelled', 'canceled', 'done', 'completed'] },
      },
      select: {
        id: true,
        name: true,
        reason: true,
        status: true,
        scheduledAt: true,
      },
    }),
  ]);

  const fromLeads: ExistingBooking[] = leads
    .filter((l) => l.scheduledStart && l.scheduledEnd)
    .map((l) => ({
      id: l.id,
      name: l.name,
      bookingType: l.bookingType,
      status: l.status,
      scheduledStart: l.scheduledStart!,
      scheduledEnd: l.scheduledEnd!,
      callId: l.callId,
    }));

  // Callbacks also block calendar slots (15 min). Show as bookingType "callback".
  const fromCallbacks: ExistingBooking[] = callbacks
    .filter((c) => c.scheduledAt)
    .map((c) => {
      const start = c.scheduledAt!;
      const end = new Date(start.getTime() + 15 * 60_000);
      const reason = (c.reason ?? '').toLowerCase();
      const bookingType =
        reason.includes('showroom') || reason.includes('test') || reason.includes('demo')
          ? reason.includes('test')
            ? 'test_drive'
            : reason.includes('demo')
              ? 'demo'
              : 'showroom_visit'
          : 'callback';
      return {
        id: `callback:${c.id}`,
        name: c.name ?? 'Callback',
        bookingType,
        status: c.status,
        scheduledStart: start,
        scheduledEnd: end,
      };
    });

  return [...fromLeads, ...fromCallbacks];
}
