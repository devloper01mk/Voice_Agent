import {
  countRecentPendingCallsMatchingTail,
  findRecentPendingCall,
  getPendingCall,
  normalizeCallId,
  purgeExpiredPendingCalls,
  resolveCallId,
} from './call-registry.js';
import { prisma } from '../db.js';

function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Last 10 digits — same mobile across +91 / 91 / local formats. */
function phoneTail(raw: string): string {
  const d = digitsOnly(raw);
  return d.length >= 10 ? d.slice(-10) : d;
}

async function findCallByIdOrNormalized(callId: string) {
  const direct = await prisma.call.findUnique({ where: { id: callId } });
  if (direct) return direct;

  const normalized = normalizeCallId(callId);
  if (normalized === callId) return null;

  const recent = await prisma.call.findMany({
    where: {
      status: { in: ['initiating', 'ringing', 'in-progress'] },
      provider: 'acefone',
    },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  return recent.find((c) => normalizeCallId(c.id) === normalized) ?? null;
}

/**
 * Resolve our Call.id from Smartflo's WebSocket start payload.
 * Prefers explicit callId / externalCallId. Phone-tail is only used when exactly
 * one recent Acefone candidate matches (no sole-pending fallback).
 */
export async function resolveCallIdForStart(
  msg: Record<string, unknown>,
): Promise<string | undefined> {
  purgeExpiredPendingCalls();

  const start = msg.start as Record<string, unknown> | undefined;
  const merged = {
    ...msg,
    ...(start ?? {}),
    customParameters: start?.customParameters,
  };

  const fromFields = resolveCallId(merged);
  if (fromFields) {
    const pending = getPendingCall(fromFields);
    if (pending) {
      console.log('[telephony] resolve start → pending custom id', pending.callId);
      return pending.callId;
    }
    const call = await findCallByIdOrNormalized(fromFields);
    if (call) {
      console.log('[telephony] resolve start → db custom id', call.id);
      return call.id;
    }
  }

  const callSid =
    (typeof start?.callSid === 'string' && start.callSid) ||
    (typeof msg.callSid === 'string' && msg.callSid) ||
    undefined;
  if (callSid) {
    const call = await prisma.call.findFirst({
      where: { externalCallId: callSid, provider: 'acefone' },
      orderBy: { startedAt: 'desc' },
    });
    if (call) {
      console.log('[telephony] resolve start → externalCallId', call.id);
      return call.id;
    }
  }

  const toDigits = digitsOnly(String(start?.to ?? msg.to ?? ''));
  const toTail = phoneTail(toDigits);
  if (toTail) {
    if (countRecentPendingCallsMatchingTail(toTail) === 1) {
      const pending = findRecentPendingCall({ toNumber: toTail });
      if (pending) {
        console.log('[telephony] resolve start → pending phone', pending.callId);
        return pending.callId;
      }
    } else if (countRecentPendingCallsMatchingTail(toTail) > 1) {
      console.warn('[telephony] resolve start → ambiguous pending phone', { toTail });
    }

    const candidates = await prisma.call.findMany({
      where: {
        provider: 'acefone',
        source: 'click-to-call',
        status: { in: ['initiating', 'ringing', 'in-progress'] },
      },
      orderBy: { startedAt: 'desc' },
      take: 30,
    });
    const matches = candidates.filter((c) => {
      const tail = phoneTail(c.toNumber ?? c.contactPhone ?? '');
      return tail === toTail;
    });
    if (matches.length === 1) {
      console.log('[telephony] resolve start → acefone phone', matches[0]!.id, { toTail });
      return matches[0]!.id;
    }
    if (matches.length > 1) {
      console.warn('[telephony] resolve start → ambiguous acefone phone', {
        toTail,
        count: matches.length,
      });
    }
  }

  console.warn('[telephony] resolve start → unresolved', {
    callSid: callSid ?? null,
    to: start?.to ?? msg.to ?? null,
    customKeys:
      start?.customParameters && typeof start.customParameters === 'object'
        ? Object.keys(start.customParameters as object)
        : [],
  });
  return undefined;
}
