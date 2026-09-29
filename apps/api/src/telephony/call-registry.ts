export interface PendingTelephonyCall {
  callId: string;
  agentId: string;
  toNumber: string;
  fromNumber?: string;
  prospectName?: string;
  contactEmail?: string;
  /** Simulator-style override: agent studio vs force Gemini Live. */
  voicePipeline?: 'agent' | 'gemini_live';
  createdAt: number;
}

const DEFAULT_PENDING_TTL_MS = 15 * 60 * 1000;

const pending = new Map<string, PendingTelephonyCall>();
const pendingByCallId = new Map<string, PendingTelephonyCall>();

export function pendingTtlMs(): number {
  const raw = Number(process.env.TELEPHONY_PENDING_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PENDING_TTL_MS;
}

export function normalizeCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '');
}

function phoneTail(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

/** Drop expired pending entries (Maps never TTL-cleaned before). */
export function purgeExpiredPendingCalls(now = Date.now()): number {
  const cutoff = now - pendingTtlMs();
  let removed = 0;
  for (const [callId, entry] of pendingByCallId) {
    if (entry.createdAt >= cutoff) continue;
    clearPendingCall(callId);
    removed += 1;
  }
  return removed;
}

export function registerPendingCall(entry: PendingTelephonyCall): void {
  purgeExpiredPendingCalls();
  pendingByCallId.set(entry.callId, entry);
  pending.set(entry.callId, entry);
  pending.set(normalizeCallId(entry.callId), entry);
}

export function clearPendingCall(callId: string): void {
  const entry = pendingByCallId.get(callId) ?? pending.get(callId) ?? pending.get(normalizeCallId(callId));
  if (!entry) return;
  pendingByCallId.delete(entry.callId);
  pending.delete(entry.callId);
  pending.delete(normalizeCallId(entry.callId));
}

export function getPendingCall(callId: string): PendingTelephonyCall | undefined {
  purgeExpiredPendingCalls();
  return pending.get(callId) ?? pending.get(normalizeCallId(callId));
}

export function findRecentPendingCall(opts?: {
  toNumber?: string;
  withinMs?: number;
}): PendingTelephonyCall | undefined {
  purgeExpiredPendingCalls();
  const withinMs = opts?.withinMs ?? pendingTtlMs();
  const cutoff = Date.now() - withinMs;
  const toTail = opts?.toNumber ? phoneTail(opts.toNumber) : '';

  let best: PendingTelephonyCall | undefined;
  for (const entry of pendingByCallId.values()) {
    if (entry.createdAt < cutoff) continue;
    if (toTail) {
      const entryTail = phoneTail(entry.toNumber);
      if (entryTail !== toTail) continue;
    }
    if (!best || entry.createdAt > best.createdAt) best = entry;
  }
  return best;
}

export function countRecentPendingCalls(withinMs = pendingTtlMs()): number {
  purgeExpiredPendingCalls();
  const cutoff = Date.now() - withinMs;
  let count = 0;
  for (const entry of pendingByCallId.values()) {
    if (entry.createdAt >= cutoff) count += 1;
  }
  return count;
}

export function countRecentPendingCallsMatchingTail(
  toTail: string,
  withinMs = pendingTtlMs(),
): number {
  purgeExpiredPendingCalls();
  const cutoff = Date.now() - withinMs;
  const tail = phoneTail(toTail);
  let count = 0;
  for (const entry of pendingByCallId.values()) {
    if (entry.createdAt < cutoff) continue;
    if (phoneTail(entry.toNumber) === tail) count += 1;
  }
  return count;
}

export function resolveCallId(input: Record<string, unknown>): string | undefined {
  const direct =
    input.callId ??
    input.call_id ??
    input.vsaCallId ??
    input.custom_identifier ??
    input.customIdentifier;
  if (typeof direct === 'string' && direct.trim()) {
    return getPendingCall(direct.trim())?.callId ?? direct.trim();
  }

  const custom = input.customParameters ?? input.custom_parameters;
  if (custom && typeof custom === 'object') {
    const c = custom as Record<string, unknown>;
    const fromCustom =
      c.callId ??
      c.call_id ??
      c.vsaCallId ??
      c.custom_identifier ??
      c.customIdentifier;
    if (typeof fromCustom === 'string' && fromCustom.trim()) {
      return getPendingCall(fromCustom.trim())?.callId ?? fromCustom.trim();
    }
  }

  const customId = input.custom_identifier ?? input.customIdentifier;
  if (customId && typeof customId === 'object') {
    const c = customId as Record<string, unknown>;
    const nested = c.call_id ?? c.vsaCallId ?? c.callId;
    if (typeof nested === 'string' && nested.trim()) {
      return getPendingCall(nested.trim())?.callId ?? nested.trim();
    }
  }
  return undefined;
}
