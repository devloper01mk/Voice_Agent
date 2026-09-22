import {
  formatOpenBookingSummary,
  getLeadMemoryRetentionHours,
  isConsumedLead,
  isOpenLead,
  leadMemoryCutoffDate,
  mergeKnownContact,
  prospectKeyFromName,
  type KnownContactProfile,
  type SkillsConfig,
} from '@vsa/shared';
import { prisma } from './db.js';

function phoneTail(phone?: string | null): string | null {
  const digits = phone?.replace(/\D/g, '');
  if (!digits || digits.length < 10) return null;
  return digits.slice(-10);
}

export type LeadMemoryResolveResult = {
  knownContact: KnownContactProfile;
  /** At most one open/upcoming booking line for the system prompt. */
  openBookingSummary: string | null;
  /** True when consumed/past bookings exist inside the retention window. */
  hasConsumedLeadHistory: boolean;
  retentionHours: number;
};

/**
 * Resolve known contact + booking memory for a call.
 * Soft TTL: rows outside the agent retention window are ignored.
 * Consumed/past bookings are never injected into the contact prompt — only flagged for recall cues.
 */
export async function resolveKnownContact(
  agentId: string,
  input: {
    prospectName?: string;
    contactPhone?: string;
    contactEmail?: string;
  },
  options?: { retentionHours?: number; skills?: SkillsConfig | null },
): Promise<LeadMemoryResolveResult> {
  const retentionHours =
    options?.retentionHours ?? getLeadMemoryRetentionHours(options?.skills ?? null);
  const cutoff = leadMemoryCutoffDate(retentionHours);
  const empty: LeadMemoryResolveResult = {
    knownContact: mergeKnownContact({
      name: input.prospectName,
      phone: input.contactPhone,
      email: input.contactEmail,
    }),
    openBookingSummary: null,
    hasConsumedLeadHistory: false,
    retentionHours,
  };

  // Retention Off → use only explicit call metadata (fresh identity collection).
  if (!cutoff) {
    return empty;
  }

  const fromMeta = mergeKnownContact({
    name: input.prospectName,
    phone: input.contactPhone,
    email: input.contactEmail,
  });

  const nameKey = prospectKeyFromName(input.prospectName);
  const prospectByName = nameKey
    ? await prisma.prospectMemory.findFirst({
        where: {
          agentId,
          prospectKey: nameKey,
          updatedAt: { gte: cutoff },
        },
      })
    : null;

  const tail = phoneTail(input.contactPhone);
  const prospectByPhone = tail
    ? await prisma.prospectMemory.findFirst({
        where: {
          agentId,
          phone: { contains: tail },
          updatedAt: { gte: cutoff },
        },
        orderBy: { updatedAt: 'desc' },
      })
    : null;

  const leadByName = input.prospectName?.trim()
    ? await prisma.lead.findFirst({
        where: {
          agentId,
          name: input.prospectName.trim(),
          OR: [{ updatedAt: { gte: cutoff } }, { createdAt: { gte: cutoff } }],
        },
        orderBy: { updatedAt: 'desc' },
      })
    : null;

  const leadsByPhone = tail
    ? await prisma.lead.findMany({
        where: {
          agentId,
          phone: { contains: tail },
          OR: [{ updatedAt: { gte: cutoff } }, { createdAt: { gte: cutoff } }],
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      })
    : [];

  const callback = tail
    ? await prisma.callback.findFirst({
        where: {
          agentId,
          phone: { contains: tail },
          createdAt: { gte: cutoff },
        },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  const allLeads = [
    ...(leadByName ? [leadByName] : []),
    ...leadsByPhone.filter((l) => !leadByName || l.id !== leadByName.id),
  ];

  const openLeads = allLeads.filter((l) => isOpenLead(l));
  const consumedLeads = allLeads.filter((l) => isConsumedLead(l));
  const openLead = openLeads[0] ?? null;

  const knownContact = mergeKnownContact(
    fromMeta,
    prospectByName
      ? {
          name: prospectByName.displayName ?? undefined,
          email: prospectByName.email ?? undefined,
          phone: prospectByName.phone ?? undefined,
        }
      : null,
    prospectByPhone
      ? {
          name: prospectByPhone.displayName ?? undefined,
          email: prospectByPhone.email ?? undefined,
          phone: prospectByPhone.phone ?? undefined,
        }
      : null,
    openLead
      ? {
          name: openLead.name,
          email: openLead.email,
          phone: openLead.phone ?? undefined,
        }
      : null,
    // Identity from a recent consumed lead is OK; booking details stay silent.
    consumedLeads[0]
      ? {
          name: consumedLeads[0].name,
          email: consumedLeads[0].email,
          phone: consumedLeads[0].phone ?? undefined,
        }
      : null,
    callback
      ? {
          name: callback.name ?? undefined,
          email: callback.email ?? undefined,
          phone: callback.phone ?? undefined,
        }
      : null,
  );

  return {
    knownContact,
    openBookingSummary: openLead ? formatOpenBookingSummary(openLead) : null,
    hasConsumedLeadHistory: consumedLeads.length > 0,
    retentionHours,
  };
}

export async function upsertProspectContact(
  agentId: string,
  contact: { name: string; email?: string; phone?: string },
  callId?: string,
): Promise<void> {
  const key = prospectKeyFromName(contact.name);
  if (!key) return;

  await prisma.prospectMemory.upsert({
    where: { agentId_prospectKey: { agentId, prospectKey: key } },
    create: {
      agentId,
      prospectKey: key,
      displayName: contact.name,
      email: contact.email,
      phone: contact.phone,
      lastCallId: callId,
    },
    update: {
      displayName: contact.name,
      ...(contact.email ? { email: contact.email } : {}),
      ...(contact.phone ? { phone: contact.phone } : {}),
      lastCallId: callId,
    },
  });
}
