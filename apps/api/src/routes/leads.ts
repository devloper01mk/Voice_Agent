import {
  isSlotAvailable,
  parsePreferredTime,
  toIstIsoDate,
  validateLeadEmail,
  validateLeadPhone,
  applyPlaybookToSkills,
  mergeSkillsConfig,
  missingBookingDiscussGates,
  missingCustomFields,
  bookingDiscussGateRejection,
  normalizeBookingTypeSlug,
  type SkillsConfig,
} from '@vsa/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getAvailabilityConfig, loadActiveBookings } from '../availability.js';
import { prisma } from '../db.js';
import { upsertProspectContact } from '../known-contact.js';

export const leadsRouter = Router();

const bookingTypeSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, 'bookingType must be a lowercase slug');
const locationTypeSchema = z.string().trim().min(1).max(32);
const detailsSchema = z.record(z.string().max(32), z.union([z.string().max(200), z.number(), z.boolean()]));
const leadStatusSchema = z.enum([
  'new',
  'confirmed',
  'completed',
  'no_show',
  'cancelled',
]);

function parseLeadEmail(raw: string) {
  const validated = validateLeadEmail(raw);
  if (!validated.ok) {
    return {
      ok: false as const,
      message: validated.error,
      hint: validated.hint,
    };
  }
  return { ok: true as const, email: validated.email };
}

function parseLeadPhone(raw: string | undefined) {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true as const, phone: undefined };
  const validated = validateLeadPhone(trimmed);
  if (!validated.ok) {
    return {
      ok: false as const,
      message: validated.error,
      hint: validated.hint,
    };
  }
  return { ok: true as const, phone: validated.phone };
}

async function resolveSchedule(opts: {
  preferredTime: string;
  bookingType?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  skipAvailabilityCheck?: boolean;
  agentId: string;
  callId?: string;
}) {
  let scheduledStart: Date | null = null;
  let scheduledEnd: Date | null = null;
  let approximate = false;

  if (opts.scheduledStart && opts.scheduledEnd) {
    scheduledStart = new Date(opts.scheduledStart);
    scheduledEnd = new Date(opts.scheduledEnd);
  } else {
    const parsed = parsePreferredTime(opts.preferredTime, {
      bookingType: opts.bookingType,
    });
    if (parsed) {
      scheduledStart = parsed.scheduledStart;
      scheduledEnd = parsed.scheduledEnd;
      approximate = parsed.approximate;
    }
  }

  if (!scheduledStart || !scheduledEnd || opts.skipAvailabilityCheck) {
    return { scheduledStart, scheduledEnd, approximate, availability: null as null };
  }

  const config = await getAvailabilityConfig(opts.agentId);
  // Calendar off / never configured → save any day without slot conflict rules.
  if (!config.enabled) {
    return { scheduledStart, scheduledEnd, approximate, availability: null as null };
  }

  const iso = toIstIsoDate(scheduledStart);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0) - 5.5 * 3600_000);
  const to = new Date(Date.UTC(year, month, 1, 0, 0, 0) - 5.5 * 3600_000);
  const bookings = (await loadActiveBookings(opts.agentId, from, to)).filter(
    (b) => !opts.callId || b.callId !== opts.callId,
  );
  const availability = isSlotAvailable(
    config,
    scheduledStart,
    scheduledEnd,
    bookings,
    opts.bookingType,
  );

  return { scheduledStart, scheduledEnd, approximate, availability };
}

leadsRouter.post('/', async (req, res) => {
  const schema = z.object({
    agentId: z.string().uuid(),
    callId: z.string().uuid().optional(),
    name: z.string(),
    email: z.string().optional().default(''),
    phone: z.string().optional(),
    preferredTime: z.string().optional().default('Not set'),
    notes: z.string().optional(),
    bookingType: bookingTypeSchema.optional(),
    productInterest: z.string().optional(),
    location: z.string().optional(),
    locationType: locationTypeSchema.optional(),
    details: detailsSchema.optional(),
    source: z.string().optional(),
    scheduledStart: z.string().datetime().optional(),
    scheduledEnd: z.string().datetime().optional(),
    skipAvailabilityCheck: z.boolean().optional(),
    forceBook: z.boolean().optional(),
    paymentDiscussed: z.boolean().optional(),
    cancellationDiscussed: z.boolean().optional(),
    idProofDiscussed: z.boolean().optional(),
    budgetDiscussed: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const agentRow = await prisma.agent.findUnique({
    where: { id: parsed.data.agentId },
    select: { skillsConfig: true, playbook: true },
  });
  if (!agentRow) return res.status(404).json({ error: 'Agent not found' });
  const bookingPolicy = applyPlaybookToSkills(
    mergeSkillsConfig(agentRow.skillsConfig as unknown as Partial<SkillsConfig> | null),
    agentRow.playbook,
  ).booking;
  const isManualCrm = parsed.data.source === 'manual';
  const missingFields = missingCustomFields(bookingPolicy, parsed.data.details);
  if (!isManualCrm && missingFields.length > 0) {
    return res.status(400).json({
      ok: false,
      error: `Missing required details: ${missingFields.map((f) => f.key).join(', ')}`,
      hint: `Do NOT say the booking is confirmed. When the caller is ready, ask for ${missingFields
        .map((f) => f.label)
        .join(', ')} (one at a time), then retry with details { ${missingFields.map((f) => f.key).join(', ')} }.`,
    });
  }
  const missingGates = missingBookingDiscussGates(bookingPolicy, {
    payment_discussed: parsed.data.paymentDiscussed === true,
    cancellation_discussed: parsed.data.cancellationDiscussed === true,
    id_proof_discussed: parsed.data.idProofDiscussed === true,
    budget_discussed: parsed.data.budgetDiscussed === true,
  });
  if (!isManualCrm && missingGates.length > 0) {
    const reject = bookingDiscussGateRejection(missingGates);
    return res.status(400).json(reject);
  }

  const emailRaw =
    parsed.data.email?.trim() || (isManualCrm ? 'pending@voice.local' : '');
  const emailResult = parseLeadEmail(emailRaw);
  if (!emailResult.ok) {
    return res.status(400).json({
      error: emailResult.message,
      hint: emailResult.hint,
    });
  }

  const phoneResult = parseLeadPhone(parsed.data.phone);
  if (!phoneResult.ok) {
    return res.status(400).json({
      error: phoneResult.message,
      hint: phoneResult.hint,
    });
  }

  if (parsed.data.callId) {
    const existing = await prisma.lead.findFirst({
      where: {
        callId: parsed.data.callId,
        status: { notIn: ['cancelled', 'canceled', 'no_show'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return res.status(200).json({
        ...existing,
        alreadyBooked: true,
        scheduleApproximate: false,
      });
    }
  }

  const bookingType = normalizeBookingTypeSlug(parsed.data.bookingType ?? 'demo') || 'demo';
  const locationType = parsed.data.locationType ?? bookingPolicy?.locationType ?? 'online';
  const preferredTime = parsed.data.preferredTime?.trim() || 'Not set';
  const schedule = await resolveSchedule({
    preferredTime,
    bookingType,
    scheduledStart: parsed.data.scheduledStart,
    scheduledEnd: parsed.data.scheduledEnd,
    skipAvailabilityCheck:
      isManualCrm || parsed.data.skipAvailabilityCheck || parsed.data.forceBook,
    agentId: parsed.data.agentId,
    callId: parsed.data.callId,
  });

  if (
    !isManualCrm &&
    schedule.availability &&
    !schedule.availability.ok &&
    !parsed.data.forceBook &&
    !parsed.data.skipAvailabilityCheck
  ) {
    return res.status(409).json({
      error: schedule.availability.reason,
      scheduledStart: schedule.scheduledStart?.toISOString(),
      scheduledEnd: schedule.scheduledEnd?.toISOString(),
      alternatives: schedule.availability.alternatives.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
      })),
    });
  }

  let source = parsed.data.source;
  if (!source && parsed.data.callId) {
    const call = await prisma.call.findUnique({
      where: { id: parsed.data.callId },
      select: { direction: true },
    });
    source = call?.direction === 'outbound' ? 'voice_outbound' : 'voice_inbound';
  }

  const lead = await prisma.lead.create({
    data: {
      agentId: parsed.data.agentId,
      callId: parsed.data.callId,
      name: parsed.data.name.trim(),
      email: emailResult.email,
      phone: phoneResult.phone,
      preferredTime,
      preferredTimeRaw: preferredTime,
      notes: parsed.data.notes,
      bookingType,
      status: 'new',
      scheduledStart: isManualCrm ? null : schedule.scheduledStart,
      scheduledEnd: isManualCrm ? null : schedule.scheduledEnd,
      productInterest: parsed.data.productInterest,
      location: parsed.data.location,
      locationType,
      details: parsed.data.details ?? {},
      source: source ?? 'voice_inbound',
      calendarSyncStatus: 'skipped',
    },
  });

  await upsertProspectContact(
    parsed.data.agentId,
    { name: parsed.data.name.trim(), email: emailResult.email, phone: phoneResult.phone },
    parsed.data.callId,
  );
  if (parsed.data.callId) {
    await prisma.call.update({
      where: { id: parsed.data.callId },
      data: { outcome: 'demo_booked' },
    });
  }

  res.status(201).json({
    ...lead,
    scheduleApproximate: isManualCrm ? false : schedule.approximate,
  });
});

/** Correct lead name after booking when STT misheard (lookup by callId). */
leadsRouter.patch('/by-call/:callId/name', async (req, res) => {
  const schema = z.object({
    agentId: z.string().uuid(),
    name: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const name = parsed.data.name.trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const lead = await prisma.lead.findFirst({
    where: { callId: req.params.callId, agentId: parsed.data.agentId },
    orderBy: { createdAt: 'desc' },
  });
  if (!lead) return res.status(404).json({ error: 'Lead not found for this call' });

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { name },
  });

  await upsertProspectContact(
    parsed.data.agentId,
    { name, email: updated.email, phone: updated.phone ?? undefined },
    req.params.callId,
  );

  res.json(updated);
});

leadsRouter.patch('/:id', async (req, res) => {
  const schema = z.object({
    status: leadStatusSchema.optional(),
    name: z.string().min(1).optional(),
    preferredTime: z.string().optional(),
    scheduledStart: z.string().datetime().optional(),
    scheduledEnd: z.string().datetime().optional(),
    notes: z.string().optional(),
    bookingType: bookingTypeSchema.optional(),
    productInterest: z.string().optional(),
    location: z.string().optional(),
    forceBook: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const existing = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Lead not found' });

  let scheduledStart = existing.scheduledStart;
  let scheduledEnd = existing.scheduledEnd;
  let preferredTime = existing.preferredTime;
  let preferredTimeRaw = existing.preferredTimeRaw || existing.preferredTime;

  if (parsed.data.preferredTime || parsed.data.scheduledStart) {
    const schedule = await resolveSchedule({
      preferredTime: parsed.data.preferredTime ?? existing.preferredTime,
      bookingType: parsed.data.bookingType ?? existing.bookingType,
      scheduledStart: parsed.data.scheduledStart,
      scheduledEnd: parsed.data.scheduledEnd,
      skipAvailabilityCheck: parsed.data.forceBook,
      agentId: existing.agentId,
    });
    if (
      schedule.availability &&
      !schedule.availability.ok &&
      !parsed.data.forceBook
    ) {
      return res.status(409).json({
        error: schedule.availability.reason,
        alternatives: schedule.availability.alternatives.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
        })),
      });
    }
    scheduledStart = schedule.scheduledStart;
    scheduledEnd = schedule.scheduledEnd;
    if (parsed.data.preferredTime) {
      preferredTime = parsed.data.preferredTime;
      preferredTimeRaw = parsed.data.preferredTime;
    }
  }

  const nextName = parsed.data.name?.trim() || existing.name;

  const lead = await prisma.lead.update({
    where: { id: existing.id },
    data: {
      status: parsed.data.status,
      name: nextName,
      notes: parsed.data.notes,
      bookingType: parsed.data.bookingType,
      productInterest: parsed.data.productInterest,
      location: parsed.data.location,
      preferredTime,
      preferredTimeRaw,
      scheduledStart,
      scheduledEnd,
      calendarSyncStatus: 'skipped',
      ...(parsed.data.status === 'cancelled' ? { googleEventId: null } : {}),
    },
  });

  if (parsed.data.name?.trim() && parsed.data.name.trim() !== existing.name) {
    await upsertProspectContact(
      existing.agentId,
      { name: nextName, email: lead.email, phone: lead.phone ?? undefined },
      lead.callId ?? undefined,
    );
  }

  res.json(lead);
});

leadsRouter.post('/callback', async (req, res) => {
  const schema = z.object({
    agentId: z.string().uuid(),
    callId: z.string().uuid().optional(),
    name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    preferredTime: z.string(),
    reason: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  let email: string | undefined;
  if (parsed.data.email?.trim()) {
    const emailResult = parseLeadEmail(parsed.data.email);
    if (!emailResult.ok) {
      return res.status(400).json({
        error: emailResult.message,
        hint: emailResult.hint,
      });
    }
    email = emailResult.email;
  }

  const phoneResult = parseLeadPhone(parsed.data.phone);
  if (!phoneResult.ok) {
    return res.status(400).json({
      error: phoneResult.message,
      hint: phoneResult.hint,
    });
  }

  // Showroom / demo / test-drive must become Lead bookings (calendar), not call-later callbacks.
  const reason = (parsed.data.reason ?? '').toLowerCase();
  const visitType = (() => {
    if (/test[_\s-]?drive/.test(reason)) return 'test_drive' as const;
    if (/simulator/.test(reason)) return 'simulator' as const;
    if (/showroom|visit|demo/.test(reason)) return 'showroom_visit' as const;
    return null;
  })();

  if (visitType) {
    if (!parsed.data.name?.trim()) {
      return res.status(400).json({
        error: 'Name required for showroom/demo booking',
        hint: 'Use capture_demo_lead with booking_type=showroom_visit (or test_drive/demo), not schedule_callback.',
      });
    }
    const schedule = await resolveSchedule({
      preferredTime: parsed.data.preferredTime,
      bookingType: visitType,
      agentId: parsed.data.agentId,
    });
    if (schedule.availability && !schedule.availability.ok) {
      return res.status(409).json({
        error: schedule.availability.reason,
        alternatives: schedule.availability.alternatives.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
        })),
        hint: 'Use capture_demo_lead for visits. Offer an in-hours alternative.',
      });
    }

    let source = 'voice_inbound';
    if (parsed.data.callId) {
      const call = await prisma.call.findUnique({
        where: { id: parsed.data.callId },
        select: { direction: true },
      });
      source = call?.direction === 'outbound' ? 'voice_outbound' : 'voice_inbound';
    }

    const lead = await prisma.lead.create({
      data: {
        agentId: parsed.data.agentId,
        callId: parsed.data.callId,
        name: parsed.data.name.trim(),
        email: email ?? 'pending@voice.local',
        phone: phoneResult.phone,
        preferredTime: parsed.data.preferredTime,
        preferredTimeRaw: parsed.data.preferredTime,
        notes: `Converted from schedule_callback (reason=${parsed.data.reason ?? visitType})`,
        bookingType: visitType,
        status: 'new',
        scheduledStart: schedule.scheduledStart,
        scheduledEnd: schedule.scheduledEnd,
        source,
        calendarSyncStatus: 'skipped',
      },
    });
    await upsertProspectContact(
      parsed.data.agentId,
      {
        name: parsed.data.name.trim(),
        email,
        phone: phoneResult.phone,
      },
      parsed.data.callId,
    );
    if (parsed.data.callId) {
      await prisma.call.update({
        where: { id: parsed.data.callId },
        data: { outcome: 'demo_booked' },
      });
    }
    return res.status(201).json({
      ...lead,
      redirectedFromCallback: true,
      message: 'Visit saved as Lead booking (not callback).',
    });
  }

  const schedule = parsePreferredTime(parsed.data.preferredTime, {
    bookingType: 'demo',
    durationMinutes: 15,
  });

  const callback = await prisma.callback.create({
    data: {
      ...parsed.data,
      email,
      phone: phoneResult.phone,
      scheduledAt: schedule?.scheduledStart ?? null,
      calendarSyncStatus: 'skipped',
    },
  });
  if (parsed.data.name?.trim()) {
    await upsertProspectContact(
      parsed.data.agentId,
      {
        name: parsed.data.name.trim(),
        email,
        phone: phoneResult.phone,
      },
      parsed.data.callId,
    );
  }
  if (parsed.data.callId) {
    await prisma.call.update({
      where: { id: parsed.data.callId },
      data: { outcome: 'callback_scheduled' },
    });
  }
  res.status(201).json(callback);
});

leadsRouter.get('/agent/:agentId/emails', async (req, res) => {
  const [leads, callbacks] = await Promise.all([
    prisma.lead.findMany({
      where: { agentId: req.params.agentId },
      select: { email: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.callback.findMany({
      where: { agentId: req.params.agentId, email: { not: null } },
      select: { email: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);
  const emails = [
    ...new Set(
      [...leads, ...callbacks]
        .map((row) => row.email?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e && e.includes('@'))),
    ),
  ];
  res.json({ emails });
});

leadsRouter.get('/agent/:agentId', async (req, res) => {
  const from = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === 'string' ? new Date(req.query.to) : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const source = typeof req.query.source === 'string' ? req.query.source : undefined;

  const leadWhere: {
    agentId: string;
    status?: string;
    source?: string;
    scheduledStart?: { gte?: Date; lt?: Date };
  } = { agentId: req.params.agentId };
  if (status) leadWhere.status = status;
  if (source) leadWhere.source = source;
  if (from || to) {
    leadWhere.scheduledStart = {};
    if (from && !Number.isNaN(from.getTime())) leadWhere.scheduledStart.gte = from;
    if (to && !Number.isNaN(to.getTime())) leadWhere.scheduledStart.lt = to;
  }

  const [leads, callbacks] = await Promise.all([
    prisma.lead.findMany({
      where: leadWhere,
      orderBy: [{ createdAt: 'desc' }, { scheduledStart: 'asc' }],
      take: 500,
      include: {
        call: {
          select: { id: true, direction: true, startedAt: true, outcome: true },
        },
      },
    }),
    source === 'manual'
      ? Promise.resolve([])
      : prisma.callback.findMany({
          where: { agentId: req.params.agentId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
  ]);
  res.json({ leads, callbacks });
});
