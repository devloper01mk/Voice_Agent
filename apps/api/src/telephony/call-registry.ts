export interface PendingTelephonyCall {
  callId: string;
  agentId: string;
  toNumber: string;
  fromNumber?: string;
  prospectName?: string;
  contactEmail?: string;
  /** Simulator-style override: agent studio vs force cascaded / S2S. */
  voicePipeline?: 'agent' | 'cascaded' | 'openai_realtime' | 'gemini_live';
  createdAt: number;
}

const pending = new Map<string, PendingTelephonyCall>();
const pendingByCallId = new Map<string, PendingTelephonyCall>();

export function normalizeCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '');
}

export function registerPendingCall(entry: PendingTelephonyCall): void {
  pendingByCallId.set(entry.callId, entry);
  pending.set(entry.callId, entry);
  pending.set(normalizeCallId(entry.callId), entry);
}

export function getPendingCall(callId: string): PendingTelephonyCall | undefined {
  return pending.get(callId) ?? pending.get(normalizeCallId(callId));
}

export function findRecentPendingCall(opts?: {
  toNumber?: string;
  withinMs?: number;
}): PendingTelephonyCall | undefined {
  const withinMs = opts?.withinMs ?? 15 * 60 * 1000;
  const cutoff = Date.now() - withinMs;
  const toTail = opts?.toNumber?.replace(/\D/g, '').slice(-10);

  let best: PendingTelephonyCall | undefined;
  for (const entry of pendingByCallId.values()) {
    if (entry.createdAt < cutoff) continue;
    if (toTail) {
      const entryTail = entry.toNumber.replace(/\D/g, '').slice(-10);
      if (entryTail !== toTail) continue;
    }
    if (!best || entry.createdAt > best.createdAt) best = entry;
  }
  return best;
}

export function countRecentPendingCalls(withinMs = 15 * 60 * 1000): number {
  const cutoff = Date.now() - withinMs;
  let count = 0;
  for (const entry of pendingByCallId.values()) {
    if (entry.createdAt >= cutoff) count += 1;
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
