import type { TelephonyEvent } from './event-types.js';

type Listener = (event: TelephonyEvent) => void;

const MAX_BUFFER = 250;
const listeners = new Map<string, Set<Listener>>();
const buffers = new Map<string, TelephonyEvent[]>();

function stamp(event: TelephonyEvent): TelephonyEvent {
  return { ...event, ts: event.ts ?? Date.now() };
}

export function emitTelephonyEvent(callId: string, event: TelephonyEvent): void {
  if (!callId) return;
  const stamped = stamp(event);
  const buf = buffers.get(callId) ?? [];
  buf.push(stamped);
  if (buf.length > MAX_BUFFER) buf.shift();
  buffers.set(callId, buf);

  for (const listener of listeners.get(callId) ?? []) {
    try {
      listener(stamped);
    } catch (err) {
      console.error('[telephony] event listener failed', err);
    }
  }
}

export function subscribeTelephonyEvents(callId: string, listener: Listener): () => void {
  if (!listeners.has(callId)) listeners.set(callId, new Set());
  listeners.get(callId)!.add(listener);

  for (const event of buffers.get(callId) ?? []) {
    try {
      listener(event);
    } catch {
      /* ignore replay errors */
    }
  }

  return () => {
    listeners.get(callId)?.delete(listener);
    if (listeners.get(callId)?.size === 0) listeners.delete(callId);
  };
}

/** Drop buffered SSE history + listeners when a call ends. */
export function clearTelephonyEventBuffer(callId: string): void {
  buffers.delete(callId);
  listeners.delete(callId);
}
