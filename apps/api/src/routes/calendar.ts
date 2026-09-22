import {
  buildMonthSummary,
  formatBookingWindowLabel,
  isSlotAvailable,
  paintDaySlots,
  parsePreferredTime,
  toIstIsoDate,
} from '@vsa/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getAvailabilityConfig, loadActiveBookings } from '../availability.js';
import { prisma } from '../db.js';

export const calendarRouter = Router();

function monthBounds(year: number, month: number): { from: Date; to: Date } {
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0) - 5.5 * 3600_000);
  const to = new Date(Date.UTC(year, month, 1, 0, 0, 0) - 5.5 * 3600_000);
  return { from, to };
}

function dayBounds(isoDate: string): { from: Date; to: Date } {
  const [y, m, d] = isoDate.split('-').map(Number);
  const from = new Date(Date.UTC(y!, m! - 1, d!, 0, 0, 0) - 5.5 * 3600_000);
  const to = new Date(Date.UTC(y!, m! - 1, d! + 1, 0, 0, 0) - 5.5 * 3600_000);
  return { from, to };
}

calendarRouter.get('/month', async (req, res) => {
  const schema = z.object({
    agentId: z.string().uuid(),
    year: z.coerce.number().int().min(2020).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    bookingType: z.string().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { agentId, year, month, bookingType } = parsed.data;
  const config = await getAvailabilityConfig(agentId);
  const { from, to } = monthBounds(year, month);
  const bookings = await loadActiveBookings(agentId, from, to);
  const days = buildMonthSummary(config, year, month, bookings, bookingType);

  res.json({
    year,
    month,
    timezone: config.timezone ?? 'Asia/Kolkata',
    calendarEnabled: config.enabled,
    bookingWindow: formatBookingWindowLabel(config),
    days,
    bookingCount: bookings.length,
  });
});

calendarRouter.get('/day', async (req, res) => {
  const schema = z.object({
    agentId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    bookingType: z.string().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { agentId, date, bookingType } = parsed.data;
  const config = await getAvailabilityConfig(agentId);
  const { from, to } = dayBounds(date);
  const bookings = await loadActiveBookings(
    agentId,
    new Date(from.getTime() - 24 * 3600_000),
    new Date(to.getTime() + 24 * 3600_000),
  );
  const slots = paintDaySlots(config, date, bookings, bookingType).map((s) => ({
    start: s.start.toISOString(),
    end: s.end.toISOString(),
    status: s.status,
    remainingCapacity: s.remainingCapacity,
    bookings: s.bookings.map((b) => ({
      id: b.id,
      name: b.name,
      bookingType: b.bookingType,
      status: b.status,
    })),
  }));

  res.json({
    date,
    timezone: config.timezone ?? 'Asia/Kolkata',
    isOpen: slots.length > 0 || config.openDays.length > 0,
    slots,
  });
});

calendarRouter.post('/check', async (req, res) => {
  const schema = z.object({
    agentId: z.string().uuid(),
    preferredTime: z.string().min(1),
    bookingType: z.string().optional(),
    scheduledStart: z.string().datetime().optional(),
    scheduledEnd: z.string().datetime().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const config = await getAvailabilityConfig(parsed.data.agentId);
  let start: Date;
  let end: Date;

  if (parsed.data.scheduledStart && parsed.data.scheduledEnd) {
    start = new Date(parsed.data.scheduledStart);
    end = new Date(parsed.data.scheduledEnd);
  } else {
    const schedule = parsePreferredTime(parsed.data.preferredTime, {
      bookingType: parsed.data.bookingType,
    });
    if (!schedule) {
      return res.status(400).json({ error: 'Could not parse preferredTime' });
    }
    start = schedule.scheduledStart;
    end = schedule.scheduledEnd;
  }

  const iso = toIstIsoDate(start);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const { from, to } = monthBounds(year, month);
  const bookings = await loadActiveBookings(parsed.data.agentId, from, to);
  const result = isSlotAvailable(config, start, end, bookings);

  if (result.ok) {
    return res.json({
      ok: true,
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
    });
  }

  res.json({
    ok: false,
    reason: result.reason,
    scheduledStart: start.toISOString(),
    scheduledEnd: end.toISOString(),
    alternatives: result.alternatives.map((s) => ({
      start: s.start.toISOString(),
      end: s.end.toISOString(),
    })),
  });
});

calendarRouter.get('/availability/:agentId', async (req, res) => {
  const row = await prisma.availabilityRules.findUnique({
    where: { agentId: req.params.agentId },
  });
  const config = await getAvailabilityConfig(req.params.agentId);
  res.json({
    config,
    stored: row,
    bookingWindow: formatBookingWindowLabel(config),
  });
});

calendarRouter.put('/availability/:agentId', async (req, res) => {
  const schema = z.object({
    enabled: z.boolean().optional(),
    timezone: z.string().optional(),
    openDays: z.array(z.number().int().min(0).max(6)).optional(),
    dayStartHour: z.number().int().min(0).max(23).optional(),
    dayStartMinute: z.number().int().min(0).max(59).optional(),
    dayEndHour: z.number().int().min(0).max(23).optional(),
    dayEndMinute: z.number().int().min(0).max(59).optional(),
    slotMinutes: z.number().int().min(15).max(240).optional(),
    capacityPerSlot: z.number().int().min(1).max(20).optional(),
    blockedDates: z.array(z.string()).optional(),
    slotMinutesByType: z.record(z.number()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const agent = await prisma.agent.findUnique({ where: { id: req.params.agentId } });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const data = {
    enabled: parsed.data.enabled ?? false,
    timezone: parsed.data.timezone ?? 'Asia/Kolkata',
    openDays: JSON.stringify(parsed.data.openDays ?? [1, 2, 3, 4, 5, 6]),
    dayStartHour: parsed.data.dayStartHour ?? 10,
    dayStartMinute: parsed.data.dayStartMinute ?? 0,
    dayEndHour: parsed.data.dayEndHour ?? 19,
    dayEndMinute: parsed.data.dayEndMinute ?? 0,
    slotMinutes: parsed.data.slotMinutes ?? 30,
    capacityPerSlot: parsed.data.capacityPerSlot ?? 1,
    blockedDates: JSON.stringify(parsed.data.blockedDates ?? []),
    slotMinutesByType: JSON.stringify(parsed.data.slotMinutesByType ?? {}),
  };

  const row = await prisma.availabilityRules.upsert({
    where: { agentId: req.params.agentId },
    create: { agentId: req.params.agentId, ...data },
    update: data,
  });

  const config = await getAvailabilityConfig(req.params.agentId);
  res.json({
    ...row,
    config,
    bookingWindow: formatBookingWindowLabel(config),
  });
});
