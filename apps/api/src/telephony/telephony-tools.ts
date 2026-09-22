import {
  formatSpokenSlotAlternatives,
  spokenPhoneForReadBack,
  validateLeadEmail,
  validateLeadPhone,
  buildCaptureDemoLeadToolDescription,
  mergeBookingPolicy,
  missingBookingDiscussGates,
  bookingDiscussGateRejection,
  bookingDiscussGateToolProperties,
  resolveBookingType,
  bookingSavedConfirmMessage,
  isNexoraHotelFactsConfigured,
  compactHotelFactsForLlm,
  resolveHotelMatchForApi,
  queryNexoraHotelFacts,
  assertLiveStayInventoryForBooking,
  lockSpokenHinglishGender,
  type BookingPolicy,
  type KnownContactProfile,
} from '@vsa/shared';
import { internalApiUrl } from './internal-api.js';

export interface TelephonyToolContext {
  agentId: string;
  callId: string;
  prospectName?: string;
  contactPhone?: string;
  contactEmail?: string;
  bookingPolicy?: BookingPolicy | null;
  agentGender?: string;
}

/** Stay agents with Nexora env get live inventory on Acefone (same as Simulator). */
export function telephonyHotelLookupEnabled(bookingPolicy?: BookingPolicy | null): boolean {
  return isNexoraHotelFactsConfigured() && mergeBookingPolicy(bookingPolicy).outcome === 'stay';
}

export type TelephonyToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

const END_CALL_DESCRIPTION = `Say a brief warm goodbye in sticky call language in the same turn, then call this to hang up.
Also call end_call when:
- Off-topic / irrelevant chat hit the redirect limit (after short product redirects).
- Timepass / casual banter hit the casual-turn limit.
- Caller is not interested and you have given the polite close.
- Explicit goodbye / bye / cut the call / DNC / wrong number.
- Thank-you after a booking was ALREADY saved this call.
Never call end_call when the caller asks who you are or why you called — restate purpose and continue.
Never call end_call when they choose a listed offering or ask what you want them to do — recommend from Product Knowledge and offer the next step.
Never call end_call when they ask for WhatsApp, brochure, pricing, email, more details, or “send info” — answer and stay on the line.
Never call end_call when they ask to schedule, book, or get a callback — use the booking/callback tools instead.
Never announce a booking time, slot, or “noted” appointment unless capture_demo_lead already returned ok:true this call.
Never say the booking is already confirmed without that tool ok:true.
If they ask a product question, answer it — do not demand name/phone first.
Do not keep chatting after the wrap limit.`;

const PREMATURE_END_CALL_RE =
  /whatsapp|wa\b|brochure|pricing|price list|email me|send\s*(me\s*)?(info|detail|brochure)|more\s*(info|detail)|wants_details|details_on|information|how\s*does|tell\s*me more|explain|prospect_wants/i;

const ALLOWED_END_CALL_RE =
  /\b(bye|goodbye|dnc|do not call|not interested|wrong number|wrap|hang\s*up|user_hangup|caller_hangup|caller_goodbye|agent_end|polite close|voicemail|silence|booking successful|saved booking|thank you after|explicit goodbye|callback later|call later|scheduled)\b/i;

/** Reject end_call when the model invents a “details” reason instead of a real close. */
export function isPrematureEndCallReason(reason?: string | null): boolean {
  const text = (reason ?? '').trim();
  if (!text) return false;
  if (ALLOWED_END_CALL_RE.test(text)) return false;
  return PREMATURE_END_CALL_RE.test(text);
}

export function createTelephonyTools(
  knownContact?: KnownContactProfile,
  bookingPolicy?: BookingPolicy | null,
): TelephonyToolDef[] {
  const knownName = knownContact?.name?.trim();
  const knownPhone = knownContact?.phone?.trim();
  const knownEmail = knownContact?.email?.trim();
  const policy = mergeBookingPolicy(bookingPolicy);
  const captureDescription = buildCaptureDemoLeadToolDescription(policy, {
    knownName,
    knownPhone,
  });
  const hotelLookup = telephonyHotelLookupEnabled(policy);

  const tools: TelephonyToolDef[] = [
    {
      type: 'function',
      function: {
        name: 'capture_demo_lead',
        description: captureDescription,
        parameters: {
          type: 'object',
          properties: {
            name: knownName
              ? { type: 'string', description: `Lead full name — omit; use known name ${knownName}` }
              : { type: 'string', description: 'Lead full name' },
            preferred_time: { type: 'string', description: 'When they want the demo / stay / visit' },
            phone: { type: 'string', description: 'WhatsApp number if different from call number' },
            notes: {
              type: 'string',
              description: policy.discussBeforeSave.includes('payment')
                ? 'Include payment/advance discussion summary when relevant'
                : 'Optional notes',
            },
            ...(hotelLookup
              ? {
                  city: {
                    type: 'string',
                    description:
                      'Property city for live inventory re-check before save (required for stay bookings)',
                  },
                  room_name: {
                    type: 'string',
                    description: 'Room type the caller chose — re-checked live before save',
                  },
                  hotel_name: {
                    type: 'string',
                    description: 'Optional branded property name if city alone is ambiguous',
                  },
                }
              : {}),
            booking_type: {
              type: 'string',
              enum: policy.allowedBookingTypes,
              description: `One of: ${policy.allowedBookingTypes.join(' | ')}. Default ${policy.bookingType}. After ok:true say "${policy.speakAs}".`,
            },
            email_skipped: { type: 'boolean' },
            name_confirmed: { type: 'boolean' },
            phone_confirmed: { type: 'boolean' },
            ...bookingDiscussGateToolProperties(policy),
          },
          required: ['preferred_time'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_callback',
        description: knownPhone
          ? `Schedule a CALL-LATER callback only (busy now / call me later). NOT for product bookings (use capture_demo_lead). Call number on file: ${knownPhone}. Requires preferred_time.`
          : 'Schedule a CALL-LATER callback only when the user is busy or asked to be called later. Do NOT use this for product bookings — use capture_demo_lead instead. Requires preferred_time.',
        parameters: {
          type: 'object',
          properties: {
            preferred_time: { type: 'string' },
            name: knownName
              ? { type: 'string', description: `Omit; use known name ${knownName}` }
              : { type: 'string' },
            phone: knownPhone
              ? { type: 'string', description: `Omit unless alternate WhatsApp; known ${knownPhone}` }
              : { type: 'string' },
            email: knownEmail
              ? { type: 'string', description: `Omit unless correcting; known ${knownEmail}` }
              : { type: 'string' },
            reason: { type: 'string' },
            phone_confirmed: { type: 'boolean' },
          },
          required: ['preferred_time'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_demo_lead_name',
        description:
          'Update the lead name for this call AFTER booking was already saved, when the caller corrects a misheard name.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            name_confirmed: { type: 'boolean' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'end_call',
        description: END_CALL_DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Why the call is ending' },
          },
        },
      },
    },
  ];

  if (hotelLookup) {
    tools.splice(1, 0, {
      type: 'function',
      function: {
        name: 'lookup_hotel_availability',
        description:
          'REQUIRED when the caller names a clear city and/or state. Live inventory. ' +
          'Pass city only if they named a city; state only if they named a state; both if they named both. ' +
          'English values (ऋषिकेश→Rishikesh, उत्तराखंड→Uttarakhand). Do NOT invent state when only city was said. ' +
          'Do NOT call this for vague places (landmark/area/"pahad"/unclear) — first clarify nearest city or offer 2–3 city choices, then call with that city. ' +
          'Every different city = a NEW call. Speak ONLY from the tool result. ' +
          'Never invent beds/prices/room names (no Suite unless listed). Never deny a city from Product Knowledge alone. ' +
          'When ok:true, live rates are spoken from "say" — do NOT invent "call later" or re-read the full list. ' +
          'When fallback_to_brain:true, never deny the city; never invent live beds/prices. ' +
          'MULTI-PROPERTY: if say asks which property, ask Hostel vs Resort — do NOT pitch dorm rates as the whole city. ' +
          'When they pick Resort / premium / Suite, call AGAIN with hotel_name (e.g. Resort) and room_name if named.',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description:
                'City in English when the caller named a city (Manali, Rishikesh, …). Omit if they only named a state.',
            },
            state: {
              type: 'string',
              description:
                'State in English ONLY when the caller named a state. Omit when they only named a city — do not invent/infer state.',
            },
            hotel_name: {
              type: 'string',
              description:
                'Property lock when heard or after they pick: e.g. "Resort", "Hostel", or full resort name. Required on second call for multi-property cities.',
            },
            room_name: {
              type: 'string',
              description:
                'Room type if they named one (Suite, Private Double Room, …). Prefer property that has this type.',
            },
          },
        },
      },
    });
  }

  return tools;
}

export const TELEPHONY_TOOLS = createTelephonyTools();

export async function executeTelephonyTool(
  name: string,
  rawArgs: string,
  ctx: TelephonyToolContext,
): Promise<unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs || '{}') as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'Invalid tool arguments' };
  }

  if (name === 'capture_demo_lead') return captureDemoLead(args, ctx);
  if (name === 'lookup_hotel_availability') return lookupHotelAvailability(args, ctx);
  if (name === 'schedule_callback') return scheduleCallback(args, ctx);
  if (name === 'update_demo_lead_name') return updateDemoLeadName(args, ctx);
  if (name === 'end_call') {
    const reason = typeof args.reason === 'string' ? args.reason.trim() : 'agent_end_call';
    if (isPrematureEndCallReason(reason)) {
      return {
        ok: false,
        hangup: false,
        error: 'Do not end the call for this reason',
        hint:
          'Stay on the line. Answer WhatsApp/details/pricing/questions, or use schedule_callback / capture_demo_lead. Only end_call after explicit bye, DNC, wrong number, clear not-interested close, wrap limit, or thank-you after a saved booking.',
      };
    }
    return {
      ok: true,
      hangup: true,
      reason: reason || 'agent_end_call',
      message: 'Call will end after you finish speaking the goodbye.',
    };
  }
  return { ok: false, error: `Unknown tool: ${name}` };
}

async function lookupHotelAvailability(
  args: Record<string, unknown>,
  ctx: TelephonyToolContext,
): Promise<unknown> {
  if (!telephonyHotelLookupEnabled(ctx.bookingPolicy)) {
    return {
      ok: false,
      error: 'Hotel live inventory is not available for this agent',
      hint: 'Use Product Knowledge only for general stay info, or offer a callback.',
    };
  }
  const asked = String(
    (typeof args.city === 'string' ? args.city.trim() : '') ||
      (typeof args.hotel_name === 'string' ? args.hotel_name.trim() : '') ||
      '',
  );
  const explicitState = typeof args.state === 'string' ? args.state.trim() : '';
  const hotelName = typeof args.hotel_name === 'string' ? args.hotel_name.trim() : '';
  const roomName = typeof args.room_name === 'string' ? args.room_name.trim() : '';
  const match = resolveHotelMatchForApi({
    city: asked || undefined,
    state: explicitState || undefined,
    hotel_name: hotelName || undefined,
  });
  const query = match.city || asked;
  const started = Date.now();
  const result = await queryNexoraHotelFacts(query, {
    signal: AbortSignal.timeout(2_500),
    ...(match.state ? { state: match.state } : {}),
    prefer: {
      ...(hotelName ? { hotel: hotelName } : {}),
      ...(roomName ? { room: roomName } : {}),
    },
  });
  const compact = compactHotelFactsForLlm(result);
  if (typeof compact.say === 'string' && compact.say) {
    compact.say = lockSpokenHinglishGender(compact.say, ctx.agentGender);
  }
  console.info(
    '[telephony][nexora] lookup_hotel_availability',
    JSON.stringify({
      callId: ctx.callId,
      asked,
      city: query || undefined,
      state: match.state,
      hotel_name: hotelName || undefined,
      room_name: roomName || undefined,
      ok: result.ok,
      hotel: result.ok ? result.hotel_name : undefined,
      matchedCity: result.ok ? result.city : undefined,
      rooms: result.ok ? result.rooms.length : undefined,
      fallback_to_brain: compact.fallback_to_brain === true || undefined,
      error: result.ok ? undefined : result.error,
      ms: Date.now() - started,
    }),
  );
  return compact;
}

async function captureDemoLead(
  args: Record<string, unknown>,
  ctx: TelephonyToolContext,
): Promise<unknown> {
  const knownName = ctx.prospectName?.trim();
  const knownPhone = ctx.contactPhone?.trim();
  const knownEmail = ctx.contactEmail?.trim();
  const resolvedName = (typeof args.name === 'string' ? args.name.trim() : '') || knownName;
  if (!resolvedName) {
    return {
      ok: false,
      error: 'Name is required',
      hint: 'Ask the caller for their name, read it back, get yes/haan, then retry with name_confirmed=true',
    };
  }
  if (!args.name_confirmed && !knownName) {
    return {
      ok: false,
      error: 'Name not confirmed',
      hint: `Read back EXACTLY: "Maine suna ${resolvedName} — yeh sahi hai?" — get yes/haan, then retry with name_confirmed=true.`,
      readBackSpeech: `Maine suna ${resolvedName} — yeh sahi hai?`,
    };
  }

  const resolvedPhone =
    (typeof args.phone === 'string' ? args.phone.trim() : '') || knownPhone;
  if (!resolvedPhone) {
    return {
      ok: false,
      error: 'Phone required when skipping email',
      hint: 'Collect and confirm phone, then retry with email_skipped=true, name_confirmed=true, and phone_confirmed=true',
    };
  }
  if (!args.phone_confirmed && !knownPhone) {
    return {
      ok: false,
      error: 'Phone not confirmed',
      hint: `Read back EXACTLY: "${spokenPhoneForReadBack(resolvedPhone)}" — get yes/haan, then retry with phone_confirmed=true.`,
      readBackSpeech: spokenPhoneForReadBack(resolvedPhone),
    };
  }
  const phoneCheck = validateLeadPhone(resolvedPhone);
  if (!phoneCheck.ok) {
    return { ok: false, error: phoneCheck.error, hint: phoneCheck.hint };
  }

  const missingGates = missingBookingDiscussGates(ctx.bookingPolicy, args);
  if (missingGates.length > 0) {
    return bookingDiscussGateRejection(missingGates);
  }

  const preferredTime = String(args.preferred_time ?? '');
  const notes = typeof args.notes === 'string' ? args.notes : undefined;
  const policy = mergeBookingPolicy(ctx.bookingPolicy);
  const resolvedBookingType = resolveBookingType(
    policy,
    typeof args.booking_type === 'string' ? args.booking_type : undefined,
  );

  let inventoryVerified: boolean | undefined;
  if (telephonyHotelLookupEnabled(policy)) {
    const gate = await assertLiveStayInventoryForBooking({
      city: typeof args.city === 'string' ? args.city : undefined,
      hotel_name: typeof args.hotel_name === 'string' ? args.hotel_name : undefined,
      room_name: typeof args.room_name === 'string' ? args.room_name : undefined,
      notes,
      signal: AbortSignal.timeout(2_500),
    });
    if (!gate.ok) {
      console.info(
        '[telephony][nexora] capture_demo_lead blocked by inventory gate',
        JSON.stringify({
          callId: ctx.callId,
          error: gate.error,
          city: gate.city,
          hotel: gate.hotel_name,
        }),
      );
      return gate;
    }
    inventoryVerified = gate.inventory_verified;
    console.info(
      '[telephony][nexora] capture_demo_lead inventory gate',
      JSON.stringify({
        callId: ctx.callId,
        inventory_verified: gate.inventory_verified,
        city: gate.city,
        hotel: gate.hotel_name,
        room: gate.room?.name,
      }),
    );
  }

  const res = await fetch(`${internalApiUrl()}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: ctx.agentId,
      callId: ctx.callId,
      name: resolvedName,
      email: knownEmail ?? 'pending@voice.local',
      phone: phoneCheck.phone,
      preferredTime,
      bookingType: resolvedBookingType,
      locationType: policy.locationType,
      productInterest: notes,
      notes: notes ? `${notes} | email skipped on call` : 'email skipped on call',
      paymentDiscussed: args.payment_discussed === true,
      cancellationDiscussed: args.cancellation_discussed === true,
      idProofDiscussed: args.id_proof_discussed === true,
      budgetDiscussed: args.budget_discussed === true,
    }),
  });

  if (!res.ok) {
    let details: { error?: string; hint?: string; alternatives?: { start: string; end: string }[] } =
      {};
    try {
      details = (await res.json()) as typeof details;
    } catch {
      /* ignore */
    }
    if (res.status === 400 && details.error) {
      return { ok: false, error: details.error, hint: details.hint };
    }
    if (res.status === 409) {
      const alts = formatSpokenSlotAlternatives(details.alternatives ?? [], 'en');
      return {
        ok: false,
        error: details.error ?? 'That time is not available',
        alternatives: details.alternatives,
        hint: alts
          ? `That slot is taken by another booking. Offer these free slots: ${alts}. If a visit was ALREADY confirmed earlier this call, do NOT say the original slot is full — restate it and end_call.`
          : `${details.error ?? 'Ask for another open day and time within this agent booking hours'}, then retry.`,
      };
    }
    return { ok: false, error: 'Failed to save demo lead', details };
  }

  let saved: { alreadyBooked?: boolean } = {};
  try {
    saved = (await res.json()) as { alreadyBooked?: boolean };
  } catch {
    /* ignore */
  }
  const alreadyBooked = saved.alreadyBooked === true;
  return {
    ok: true,
    alreadyBooked,
    name: resolvedName,
    email_skipped: true,
    preferred_time: preferredTime,
    booking_type: resolvedBookingType,
    speak_as: policy.speakAs,
    ...(inventoryVerified !== undefined ? { inventory_verified: inventoryVerified } : {}),
    message: bookingSavedConfirmMessage(policy, {
      alreadyBooked,
      bookingType: resolvedBookingType,
    }),
  };
}

async function scheduleCallback(
  args: Record<string, unknown>,
  ctx: TelephonyToolContext,
): Promise<unknown> {
  const knownName = ctx.prospectName?.trim();
  const knownPhone = ctx.contactPhone?.trim();
  const knownEmail = ctx.contactEmail?.trim();
  const resolvedName = (typeof args.name === 'string' ? args.name.trim() : '') || knownName;
  const resolvedPhone =
    (typeof args.phone === 'string' ? args.phone.trim() : '') || knownPhone;

  if (resolvedPhone && !args.phone_confirmed && !knownPhone) {
    return {
      ok: false,
      error: 'Phone not confirmed',
      hint: 'Read back digits in groups and get yes before saving.',
    };
  }

  let cleanedPhone: string | undefined;
  if (resolvedPhone) {
    const phoneCheck = validateLeadPhone(resolvedPhone);
    if (!phoneCheck.ok) {
      return { ok: false, error: phoneCheck.error, hint: phoneCheck.hint };
    }
    cleanedPhone = phoneCheck.phone;
  }

  let normalizedEmail: string | undefined = knownEmail;
  if (typeof args.email === 'string' && args.email.trim()) {
    const validated = validateLeadEmail(args.email);
    if (!validated.ok) {
      return { ok: false, error: validated.error, hint: validated.hint };
    }
    normalizedEmail = validated.email;
  }

  const res = await fetch(`${internalApiUrl()}/api/leads/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: ctx.agentId,
      callId: ctx.callId,
      preferredTime: args.preferred_time,
      name: resolvedName,
      phone: cleanedPhone,
      email: normalizedEmail,
      reason: args.reason,
    }),
  });
  if (!res.ok) {
    let details: unknown;
    try {
      details = await res.json();
    } catch {
      details = undefined;
    }
    return { ok: false, error: 'Failed to schedule callback', details };
  }
  return { ok: true, preferred_time: args.preferred_time };
}

async function updateDemoLeadName(
  args: Record<string, unknown>,
  ctx: TelephonyToolContext,
): Promise<unknown> {
  const resolvedName = typeof args.name === 'string' ? args.name.trim() : '';
  if (!resolvedName) {
    return { ok: false, error: 'Name is required' };
  }
  if (!args.name_confirmed) {
    return {
      ok: false,
      error: 'Name not confirmed',
      hint: `Read back EXACTLY: "Maine suna ${resolvedName} — yeh sahi hai?" then retry with name_confirmed=true.`,
      readBackSpeech: `Maine suna ${resolvedName} — yeh sahi hai?`,
    };
  }
  const res = await fetch(`${internalApiUrl()}/api/leads/by-call/${ctx.callId}/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: ctx.agentId, name: resolvedName }),
  });
  if (!res.ok) {
    return { ok: false, error: 'Failed to update lead name' };
  }
  return {
    ok: true,
    name: resolvedName,
    message: 'Lead name updated. Give one short ack — do not re-announce the full booking.',
  };
}
