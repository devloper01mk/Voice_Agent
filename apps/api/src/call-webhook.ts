import { createHmac } from 'node:crypto';
import { linesFromTranscriptPayload } from '@vsa/shared';
import { prisma } from './db.js';

export type CallDisposition =
  | 'demo_booked'
  | 'callback_scheduled'
  | 'voicemail'
  | 'not_interested'
  | 'no_answer'
  | 'busy'
  | 'failed'
  | 'completed';

export type CallIntent =
  | 'booked'
  | 'wanted_but_not_booked'
  | 'callback'
  | 'not_interested'
  | 'no_answer'
  | 'busy'
  | 'voicemail'
  | 'failed'
  | 'other';

export type CallSentiment = 'positive' | 'neutral' | 'negative';

export interface CallCompletedBookingPayload {
  booked: boolean;
  leadId: string;
  bookingId?: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  bookingType: string | null;
  status: string;
  preferredTime: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  timezone: string;
  city: string | null;
  state: string | null;
  propertyName: string | null;
  roomName: string | null;
  location: string | null;
  productInterest: string | null;
  notes: string | null;
  source: string | null;
}

export interface CallCompletedWebhookPayload {
  event: 'call.completed';
  callId: string;
  agentId: string;
  agentName: string;
  direction: string;
  source: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  contact: {
    name: string | null;
    phone: string | null;
    email: string | null;
  };
  user_status: {
    wanted_to_book: boolean;
    booked: boolean;
    intent: CallIntent;
    sentiment: CallSentiment;
    goals_met: boolean;
  };
  summary: string;
  disposition: CallDisposition;
  booking: CallCompletedBookingPayload | null;
  callbacks: Array<{
    id: string;
    preferredTime: string | null;
    status: string;
    scheduledAt: string | null;
    phone: string | null;
  }>;
  transcript: {
    lines: Array<{
      id: string;
      role: string;
      text: string;
      isFinal?: boolean;
      timestamp: number;
    }>;
    metrics?: Record<string, unknown>;
  };
  post_call_analysis: {
    disposition: CallDisposition;
    sentiment: CallSentiment;
    goals_met: boolean;
  };
  /** @deprecated Prefer `booking` + `contact`. Kept for older consumers. */
  leads?: Array<{
    id: string;
    name: string;
    bookingType: string | null;
    status: string;
    scheduledStart: string | null;
    phone: string | null;
    email: string | null;
  }>;
  fromNumber?: string | null;
  toNumber?: string | null;
  prospectName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  externalCallId?: string | null;
}

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'no-answer',
  'no_answer',
  'dial_timeout',
  'busy',
]);

const NOT_INTERESTED_RE =
  /\b(not interested|no need|stop calling|don'?t call|mat call|call mat karo|interest nahi|nahi chahiye)\b/i;

const POSITIVE_RE =
  /\b(thank|dhanyavad|book|confirm|theek hai|haan ji|interested|demo|visit|callback)\b/i;

const NEGATIVE_RE =
  /\b(not interested|no need|stop calling|don'?t call|mat call|busy now|call mat)\b/i;

const WANT_BOOK_RE =
  /\b(book|booking|reserve|reservation|room\s*chahiye|book\s*kar|confirm\s*kar|le\s*lunga|le\s*lenge|stay\s*kar|check[\s-]?in)\b|बुक|कमरा\s*चाहि|रूम\s*चाहि/i;

type LeadRow = {
  id: string;
  name: string;
  bookingType: string | null;
  status: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  preferredTime: string | null;
  timezone: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  productInterest: string | null;
  location: string | null;
  source: string | null;
};

function webhookUrls(): string[] {
  const raw =
    process.env.CALL_COMPLETED_WEBHOOK_URL?.trim() ||
    process.env.TELEPHONY_WEBHOOK_URL?.trim() ||
    '';
  if (!raw) return [];
  return raw
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

function webhookSecret(): string | undefined {
  return (
    process.env.CALL_WEBHOOK_SECRET?.trim() ||
    process.env.TELEPHONY_WEBHOOK_SECRET?.trim() ||
    undefined
  );
}

/** Nexora voice ingest uses X-Nexora-Ingest-Token (falls back to facts ingest token). */
function nexoraIngestToken(): string | undefined {
  return (
    process.env.CALL_COMPLETED_WEBHOOK_TOKEN?.trim() ||
    process.env.NEXORA_VOICE_INGEST_TOKEN?.trim() ||
    process.env.NEXORA_INGEST_TOKEN?.trim() ||
    undefined
  );
}

export function resolveCallDisposition(input: {
  status: string;
  outcome?: string | null;
  transcript: unknown;
  leadsCount?: number;
  callbacksCount?: number;
}): CallDisposition {
  const status = input.status.toLowerCase();
  const outcome = (input.outcome ?? '').toLowerCase().trim();

  if (status === 'no-answer' || status === 'no_answer' || status === 'dial_timeout') {
    return 'no_answer';
  }
  if (status === 'busy') return 'busy';
  if (status === 'failed') return 'failed';
  if (outcome === 'voicemail_left') return 'voicemail';
  if (outcome === 'demo_booked' || (input.leadsCount ?? 0) > 0) return 'demo_booked';
  if (outcome === 'callback_scheduled' || (input.callbacksCount ?? 0) > 0) {
    return 'callback_scheduled';
  }

  const lines = linesFromTranscriptPayload(input.transcript);
  const userText = lines
    .filter((l) => l.role === 'user')
    .map((l) => l.text)
    .join(' ');
  if (NOT_INTERESTED_RE.test(userText)) return 'not_interested';

  if (status === 'completed' || outcome === 'completed') return 'completed';
  return 'failed';
}

export function inferCallSentiment(transcript: unknown): CallSentiment {
  const userText = linesFromTranscriptPayload(transcript)
    .filter((l) => l.role === 'user')
    .map((l) => l.text)
    .join(' ')
    .toLowerCase();
  if (!userText.trim()) return 'neutral';
  if (NEGATIVE_RE.test(userText)) return 'negative';
  if (POSITIVE_RE.test(userText)) return 'positive';
  return 'neutral';
}

function userWantedToBook(transcript: unknown, booked: boolean): boolean {
  if (booked) return true;
  const userText = linesFromTranscriptPayload(transcript)
    .filter((l) => l.role === 'user')
    .map((l) => l.text)
    .join(' ');
  return WANT_BOOK_RE.test(userText);
}

export function resolveCallIntent(input: {
  disposition: CallDisposition;
  booked: boolean;
  wantedToBook: boolean;
}): CallIntent {
  if (input.booked || input.disposition === 'demo_booked') return 'booked';
  if (input.disposition === 'callback_scheduled') return 'callback';
  if (input.disposition === 'not_interested') return 'not_interested';
  if (input.disposition === 'no_answer') return 'no_answer';
  if (input.disposition === 'busy') return 'busy';
  if (input.disposition === 'voicemail') return 'voicemail';
  if (input.disposition === 'failed') return 'failed';
  if (input.wantedToBook) return 'wanted_but_not_booked';
  return 'other';
}

function buildSummary(opts: {
  disposition: CallDisposition;
  durationSec: number;
  prospectName?: string | null;
  booking: CallCompletedBookingPayload | null;
}): string {
  const who = opts.prospectName?.trim() ? ` with ${opts.prospectName.trim()}` : '';
  const mins = Math.max(1, Math.round(opts.durationSec / 60));
  if (opts.booking?.booked) {
    const place =
      opts.booking.city ||
      opts.booking.location ||
      opts.booking.propertyName ||
      'property';
    const room = opts.booking.roomName || opts.booking.productInterest;
    const roomBit = room ? `; ${room}` : '';
    return `Caller booked ${place}${roomBit}${who} (${mins} min call).`;
  }
  const labels: Record<CallDisposition, string> = {
    demo_booked: 'Demo or visit booked',
    callback_scheduled: 'Callback scheduled',
    voicemail: 'Voicemail message left',
    not_interested: 'Prospect not interested',
    no_answer: 'No answer',
    busy: 'Line busy',
    failed: 'Call failed',
    completed: 'Conversation completed',
  };
  return `${labels[opts.disposition]}${who} (${mins} min call).`;
}

function transcriptPayload(transcript: unknown): CallCompletedWebhookPayload['transcript'] {
  if (!transcript || typeof transcript !== 'object') {
    return { lines: [] };
  }
  if (Array.isArray(transcript)) {
    return { lines: transcript as CallCompletedWebhookPayload['transcript']['lines'] };
  }
  const obj = transcript as { lines?: unknown; metrics?: Record<string, unknown> };
  const lines = Array.isArray(obj.lines)
    ? (obj.lines as CallCompletedWebhookPayload['transcript']['lines'])
    : [];
  return { lines, metrics: obj.metrics };
}

function goalsMet(disposition: CallDisposition): boolean {
  return disposition === 'demo_booked' || disposition === 'callback_scheduled';
}

/** Best-effort parse "City: X" / "city=X" style hints from notes. */
function parseNoteField(notes: string | null | undefined, key: RegExp): string | null {
  if (!notes?.trim()) return null;
  const m = notes.match(key);
  const v = m?.[1]?.trim();
  return v || null;
}

function buildBookingPayload(lead: LeadRow | undefined): CallCompletedBookingPayload | null {
  if (!lead) return null;
  const notes = lead.notes ?? null;
  const city =
    parseNoteField(notes, /\bcity\s*[:=]\s*([^;,\n]+)/i) ||
    (lead.location && !/,/.test(lead.location) ? lead.location : null) ||
    parseNoteField(lead.location, /^([^,]+)/) ||
    null;
  const state =
    parseNoteField(notes, /\bstate\s*[:=]\s*([^;,\n]+)/i) ||
    (lead.location?.includes(',')
      ? lead.location.split(',').slice(1).join(',').trim() || null
      : null);
  const propertyName =
    parseNoteField(notes, /\b(?:property|hotel)\s*[:=]\s*([^;,\n]+)/i) || null;
  const roomName =
    lead.productInterest?.trim() ||
    parseNoteField(notes, /\broom\s*[:=]\s*([^;,\n]+)/i) ||
    null;

  return {
    booked: true,
    leadId: lead.id,
    bookingId: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    bookingType: lead.bookingType,
    status: lead.status,
    preferredTime: lead.preferredTime,
    scheduledStart: lead.scheduledStart?.toISOString() ?? null,
    scheduledEnd: lead.scheduledEnd?.toISOString() ?? null,
    timezone: lead.timezone?.trim() || 'Asia/Kolkata',
    city,
    state,
    propertyName,
    roomName,
    location: lead.location,
    productInterest: lead.productInterest,
    notes,
    source: lead.source,
  };
}

export function buildCallCompletedPayload(call: {
  id: string;
  agentId: string;
  direction: string;
  source: string;
  status: string;
  outcome: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  prospectName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  externalCallId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  transcript: unknown;
  agent: { name: string };
  leads: LeadRow[];
  callbacks: Array<{
    id: string;
    preferredTime: string | null;
    status: string;
    scheduledAt: Date | null;
    phone: string | null;
  }>;
}): CallCompletedWebhookPayload {
  const endedAt = call.endedAt ?? new Date();
  const durationSec = Math.max(0, Math.floor((endedAt.getTime() - call.startedAt.getTime()) / 1000));
  const disposition = resolveCallDisposition({
    status: call.status,
    outcome: call.outcome,
    transcript: call.transcript,
    leadsCount: call.leads.length,
    callbacksCount: call.callbacks.length,
  });
  const sentiment = inferCallSentiment(call.transcript);
  const primaryLead = call.leads[0];
  const booking = buildBookingPayload(primaryLead);
  const booked = Boolean(booking?.booked);
  const wantedToBook = userWantedToBook(call.transcript, booked);
  const intent = resolveCallIntent({ disposition, booked, wantedToBook });
  const met = goalsMet(disposition);
  const contactName =
    primaryLead?.name?.trim() || call.prospectName?.trim() || null;
  const contactPhone =
    primaryLead?.phone?.trim() || call.contactPhone?.trim() || call.toNumber || call.fromNumber;
  const contactEmail =
    primaryLead?.email?.trim() || call.contactEmail?.trim() || null;

  return {
    event: 'call.completed',
    callId: call.id,
    agentId: call.agentId,
    agentName: call.agent.name,
    direction: call.direction,
    source: call.source,
    status: call.status,
    startedAt: call.startedAt.toISOString(),
    endedAt: call.endedAt?.toISOString() ?? endedAt.toISOString(),
    durationSec,
    contact: {
      name: contactName,
      phone: contactPhone ?? null,
      email: contactEmail,
    },
    user_status: {
      wanted_to_book: wantedToBook,
      booked,
      intent,
      sentiment,
      goals_met: met,
    },
    summary: buildSummary({
      disposition,
      durationSec,
      prospectName: contactName,
      booking,
    }),
    disposition,
    booking,
    callbacks: call.callbacks.map((cb) => ({
      id: cb.id,
      preferredTime: cb.preferredTime,
      status: cb.status,
      scheduledAt: cb.scheduledAt?.toISOString() ?? null,
      phone: cb.phone,
    })),
    transcript: transcriptPayload(call.transcript),
    post_call_analysis: {
      disposition,
      sentiment,
      goals_met: met,
    },
    // Legacy fields
    leads: call.leads.map((lead) => ({
      id: lead.id,
      name: lead.name,
      bookingType: lead.bookingType,
      status: lead.status,
      scheduledStart: lead.scheduledStart?.toISOString() ?? null,
      phone: lead.phone,
      email: lead.email,
    })),
    fromNumber: call.fromNumber,
    toNumber: call.toNumber,
    prospectName: call.prospectName,
    contactPhone: call.contactPhone,
    contactEmail: call.contactEmail,
    externalCallId: call.externalCallId,
  };
}

function signBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

async function postWebhookOnce(url: string, body: string, headers: Record<string, string>): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    // Nexora LAN ingest often takes 4–8s; 10s was too tight for full transcripts.
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Webhook ${url} returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
}

async function postWebhook(url: string, payload: CallCompletedWebhookPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'VoiceSalesAgent/1.0',
    'X-VSA-Event': 'call.completed',
  };
  const token = nexoraIngestToken();
  if (token) headers['X-Nexora-Ingest-Token'] = token;
  const secret = webhookSecret();
  if (secret) headers['X-VSA-Signature'] = `sha256=${signBody(body, secret)}`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await postWebhookOnce(url, body, headers);
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[webhook] attempt failed', { url, attempt, message: msg });
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Webhook delivery failed');
}

export async function dispatchCallCompletedWebhook(callId: string): Promise<void> {
  const urls = webhookUrls();
  if (!urls.length) {
    console.warn('[webhook] call.completed skipped — CALL_COMPLETED_WEBHOOK_URL not set', { callId });
    return;
  }

  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: {
      agent: { select: { name: true } },
      leads: {
        select: {
          id: true,
          name: true,
          bookingType: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          preferredTime: true,
          timezone: true,
          phone: true,
          email: true,
          notes: true,
          productInterest: true,
          location: true,
          source: true,
        },
      },
      callbacks: {
        select: {
          id: true,
          preferredTime: true,
          status: true,
          scheduledAt: true,
          phone: true,
        },
      },
    },
  });
  if (!call) return;
  if (call.webhookSentAt) return;
  if (!TERMINAL_STATUSES.has(call.status)) return;

  const payload = buildCallCompletedPayload(call);
  let delivered = false;
  const errors: string[] = [];

  for (const url of urls) {
    try {
      await postWebhook(url, payload);
      delivered = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook delivery failed';
      errors.push(message);
      console.error('[webhook] call.completed failed', { callId, url, message });
    }
  }

  if (delivered) {
    await prisma.call.update({
      where: { id: callId },
      data: { webhookSentAt: new Date() },
    }).catch((err) => {
      console.error('[webhook] failed to mark webhookSentAt', callId, err);
    });
    console.log('[webhook] call.completed delivered', {
      callId,
      disposition: payload.disposition,
      intent: payload.user_status.intent,
      booked: payload.user_status.booked,
      urls: urls.length,
    });
  } else if (errors.length) {
    console.error('[webhook] all destinations failed', { callId, errors });
  }
}
