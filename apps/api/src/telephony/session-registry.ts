import type { TelephonyCallSession } from './call-session.js';

const sessions = new Map<string, TelephonyCallSession>();

export function registerCallSession(callId: string, session: TelephonyCallSession): void {
  sessions.set(callId, session);
}

export function getCallSession(callId: string): TelephonyCallSession | undefined {
  return sessions.get(callId);
}

export function hasCallSession(callId: string): boolean {
  return sessions.has(callId);
}

export function unregisterCallSession(callId: string, session?: TelephonyCallSession): void {
  const current = sessions.get(callId);
  if (!session || current === session) sessions.delete(callId);
}
