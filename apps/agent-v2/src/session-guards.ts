import { voice } from '@livekit/agents';
import {
  FAKE_BOOKING_CORRECTION_LINE,
  FAKE_BOOKING_CORRECTION_LINE_EN,
  lockSpokenHinglishGender,
  looksLikeBookingConfirmedClaim,
  spokenIntakeCorrection,
  spokenToolLeakLine,
  updateCallLanguageLock,
  type CallLanguageLock,
} from '@vsa/shared';
import type { BookingLockBox } from './user-turn-handler.js';
import { speakLine } from './speak-line.js';

/** Do not stack corrections when Gemini keeps talking about booking. */
export const FAKE_BOOKING_CORRECTION_COOLDOWN_MS = 20_000;

export function shouldCorrectFakeBooking(agentText: string, bookingSaved: boolean): boolean {
  if (bookingSaved) return false;
  const text = agentText.trim();
  if (!text) return false;
  // Never correct our own correction line (or a truncated replay of it).
  if (text === FAKE_BOOKING_CORRECTION_LINE || text === FAKE_BOOKING_CORRECTION_LINE_EN) return false;
  if (/^Abhi booking save pending/i.test(text)) return false;
  if (/^The booking is not saved yet/i.test(text)) return false;
  return looksLikeBookingConfirmedClaim(text);
}

function messageText(content: Array<string | { value?: string }>): string {
  return content
    .map((c) => (typeof c === 'string' ? c : (c.value ?? '')))
    .join('')
    .trim();
}

/**
 * Gemini Live never runs onUserTurnCompleted, so booking-lie detection has to
 * watch the assistant transcript after it is spoken.
 */
export function attachSessionGuards(
  session: voice.AgentSession,
  opts: { bookingLock: BookingLockBox; agentGender?: string },
): void {
  let correcting = false;
  let lastCorrected = '';
  let lastCorrectionAt = 0;
  let languageLock: CallLanguageLock | null = null;
  const userTurns: string[] = [];
  const assistantTurns: string[] = [];

  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, async (ev) => {
    if (ev.item.type !== 'message') return;
    const msg = ev.item as { role?: string; content?: Array<string | { value?: string }> };
    const text = messageText(msg.content ?? []);
    if (!text) return;
    if (msg.role === 'user') {
      languageLock = updateCallLanguageLock(text, languageLock);
      userTurns.push(text);
      if (userTurns.length > 16) userTurns.shift();
      return;
    }
    if (msg.role !== 'assistant') return;
    const line =
      spokenToolLeakLine(text, languageLock, opts.bookingLock.saved) ??
      spokenIntakeCorrection({
      language: languageLock,
      assistantText: text,
      userTurns,
      assistantTurns,
      bookingSaved: opts.bookingLock.saved,
    });
    assistantTurns.push(text);
    if (assistantTurns.length > 16) assistantTurns.shift();
    if (!line || line === lastCorrected) return;
    if (correcting) return;
    if (Date.now() - lastCorrectionAt < FAKE_BOOKING_CORRECTION_COOLDOWN_MS) return;
    correcting = true;
    lastCorrected = line;
    lastCorrectionAt = Date.now();
    console.warn('INTAKE_CORRECTED', JSON.stringify({ preview: text.slice(0, 80), line: line.slice(0, 80) }));
    try {
      await speakLine(session, lockSpokenHinglishGender(line, opts.agentGender), {
        allowInterruptions: true,
      });
    } finally {
      correcting = false;
    }
  });
}
