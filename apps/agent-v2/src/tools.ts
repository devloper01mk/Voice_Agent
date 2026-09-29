import {
  formatSpokenSlotAlternatives,
  spokenPhoneForReadBack,
  validateLeadEmail,
  validateLeadPhone,
  buildCaptureDemoLeadToolDescription,
  mergeBookingPolicy,
  missingBookingDiscussGates,
  bookingDiscussGateRejection,
  resolveBookingType,
  bookingSavedConfirmMessage,
  assertLiveStayInventoryForBooking,
  type BookingPolicy,
  type KnownContactProfile,
  lockSpokenHinglishGender,
  isNexoraHotelFactsConfigured,
  compactHotelFactsForLlm,
  resolveHotelMatchForApi,
  queryNexoraHotelFacts,
  parseStayRoomTypeList,
  PRODUCT_KNOWLEDGE_SEARCH_TOOL,
  PRODUCT_KNOWLEDGE_SEARCH_TOOL_DESCRIPTION,
} from '@vsa/shared';
import { llm } from '@livekit/agents';
import { z } from 'zod';
import { apiFetch } from './api-fetch.js';

export type LeadToolHooks = {
  onBookingSaved?: (preferredTime: string) => void;
};

/** Zod enum from this agent's allowedBookingTypes (not a global product list). */
function bookingTypeParamSchema(allowed: string[], defaultType: string) {
  const list = (allowed.length ? allowed : [defaultType]) as [string, ...string[]];
  return z
    .enum(list)
    .optional()
    .describe(
      `One of: ${list.join(' | ')}. Default ${defaultType}. Only types for THIS agent — do not invent others.`,
    );
}

export function createTools(
  agentId: string,
  callId?: string,
  knownContact?: KnownContactProfile,
  hooks?: LeadToolHooks,
  bookingPolicy?: BookingPolicy | null,
  agentGender?: string,
) {
  const knownName = knownContact?.name?.trim();
  const knownEmail = knownContact?.email?.trim();
  const knownPhone = knownContact?.phone?.trim();
  const policy = mergeBookingPolicy(bookingPolicy);
  const captureDescription = buildCaptureDemoLeadToolDescription(policy, {
    knownName,
    knownPhone,
  });
  const stayInventoryEnabled = isNexoraHotelFactsConfigured() && policy.outcome === 'stay';

  const customFields = policy.customFields ?? [];
  const detailsShape: Record<string, z.ZodTypeAny> = {};
  for (const field of customFields) {
    detailsShape[field.key] = z
      .string()
      .optional()
      .describe(`${field.label}${field.required ? ' (required before save)' : ''} — exactly as the caller said it`);
  }

  const discussShape: Record<string, z.ZodTypeAny> = {};
  for (const gate of policy.discussBeforeSave) {
    discussShape[`${gate}_discussed`] = z
      .boolean()
      .optional()
      .describe(
        `Set true ONLY after discussing ${gate} from Product Knowledge and caller ack (required by booking policy)`,
      );
  }

  return {
    capture_demo_lead: llm.tool({
      description: captureDescription,
      parameters: z.object({
        name: knownName
          ? z
              .string()
              .optional()
              .describe(`Lead full name — omit; use known name ${knownName}`)
          : z.string().describe('Lead full name'),
        preferred_time: z.string().describe('When they want the booking / appointment'),
        phone: z.string().optional().describe('WhatsApp number if different from call number'),
        notes: z.string().optional(),
        ...(stayInventoryEnabled
          ? {
              city: z
                .string()
                .optional()
                .describe('Property city — required for live inventory re-check before save'),
              room_name: z
                .string()
                .optional()
                .describe(
                  'Room type(s) they chose. One name, or several exact names joined by " + " / commas (e.g. "6 Bed Mixed Dorm + 4 Bed Mixed Dorm + Female Dorm + Private Double Room"). Re-checked live as known.room_type string[].',
                ),
              hotel_name: z
                .string()
                .optional()
                .describe('Optional branded property name if city alone is ambiguous'),
            }
          : {}),
        booking_type: bookingTypeParamSchema(policy.allowedBookingTypes, policy.bookingType),
        email_skipped: z
          .boolean()
          .optional()
          .describe('Always treat as true for bookings — book on phone only'),
        name_confirmed: z
          .boolean()
          .optional()
          .describe('Set true after caller confirmed name read-back (required when name is new)'),
        phone_confirmed: z
          .boolean()
          .optional()
          .describe('Set true after caller confirmed phone read-back (required for new phone)'),
        ...(customFields.length
          ? {
              details: z
                .object(detailsShape)
                .optional()
                .describe('Playbook details collected on this call'),
            }
          : {}),
        ...discussShape,
      }),
      execute: async (raw) => {
        const args = raw as {
          name?: string;
          preferred_time: string;
          phone?: string;
          notes?: string;
          city?: string;
          room_name?: string;
          hotel_name?: string;
          booking_type?: string;
          name_confirmed?: boolean;
          phone_confirmed?: boolean;
          payment_discussed?: boolean;
          cancellation_discussed?: boolean;
          id_proof_discussed?: boolean;
          budget_discussed?: boolean;
          details?: Record<string, string>;
        };
        const {
          name,
          preferred_time,
          phone,
          notes,
          booking_type,
          name_confirmed,
          phone_confirmed,
        } = args;
        const resolvedBookingType = resolveBookingType(policy, booking_type);
        const resolvedName = name?.trim() || knownName;
        if (!resolvedName) {
          return {
            ok: false,
            error: 'Name is required',
            hint: 'Ask the caller for their name, read it back, get yes/haan, then retry with name_confirmed=true',
          };
        }
        if (!name_confirmed && !knownName) {
          return {
            ok: false,
            error: 'Name not confirmed',
            hint: `Read back EXACTLY: "Maine suna ${resolvedName} — yeh sahi hai?" — get yes/haan, then retry with name_confirmed=true.`,
            readBackSpeech: `Maine suna ${resolvedName} — yeh sahi hai?`,
          };
        }

        const resolvedPhone = phone?.trim() || knownPhone;
        if (!resolvedPhone) {
          return {
            ok: false,
            error: 'Phone required when skipping email',
            hint: 'Collect and confirm phone, then retry with email_skipped=true, name_confirmed=true, and phone_confirmed=true',
          };
        }
        if (!phone_confirmed && !knownPhone) {
          return {
            ok: false,
            error: 'Phone not confirmed',
            hint: `Speak VERBATIM (never paraphrase, never say double/triple): "${spokenPhoneForReadBack(resolvedPhone)}" — then ask yeh sahi hai? Get yes/haan, then retry with phone_confirmed=true, name_confirmed=true, and email_skipped=true.`,
            readBackSpeech: spokenPhoneForReadBack(resolvedPhone),
          };
        }
        const phoneCheck = validateLeadPhone(resolvedPhone);
        if (!phoneCheck.ok) {
          return { ok: false, error: phoneCheck.error, hint: phoneCheck.hint };
        }

        const missingGates = missingBookingDiscussGates(policy, args);
        if (missingGates.length > 0) {
          return bookingDiscussGateRejection(missingGates);
        }

        let inventoryVerified: boolean | undefined;
        if (stayInventoryEnabled) {
          const gate = await assertLiveStayInventoryForBooking({
            city: args.city,
            hotel_name: args.hotel_name,
            room_name: args.room_name,
            preferred_time,
            notes,
            signal: AbortSignal.timeout(2_500),
          });
          if (!gate.ok) {
            console.info(
              '[nexora] capture_demo_lead blocked by inventory gate',
              JSON.stringify({ callId, error: gate.error, city: gate.city }),
            );
            return gate;
          }
          inventoryVerified = gate.inventory_verified;
          console.info(
            '[nexora] capture_demo_lead inventory gate',
            JSON.stringify({
              callId,
              inventory_verified: gate.inventory_verified,
              city: gate.city,
              hotel: gate.hotel_name,
              room: gate.room?.name,
            }),
          );
        }

        const res = await apiFetch(`/api/leads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            callId,
            name: resolvedName,
            email: knownEmail ?? 'pending@voice.local',
            phone: phoneCheck.phone,
            preferredTime: preferred_time,
            bookingType: resolvedBookingType,
            locationType: policy.locationType,
            ...(args.details ? { details: args.details } : {}),
            productInterest: notes,
            notes: notes ? `${notes} | email skipped on call` : 'email skipped on call',
            paymentDiscussed: args.payment_discussed === true,
            cancellationDiscussed: args.cancellation_discussed === true,
            idProofDiscussed: args.id_proof_discussed === true,
            budgetDiscussed: args.budget_discussed === true,
          }),
        });
        if (!res.ok) {
          let details: {
            error?: string;
            hint?: string;
            alternatives?: { start: string; end: string }[];
          } = {};
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
                ? `That slot is taken by another booking. Offer these free slots (speak exactly, no colon): ${alts}. Ask which one works, then retry capture_demo_lead with that preferred_time. If a visit was ALREADY confirmed earlier this call, do NOT say the original slot is full — restate it and end_call.`
                : `Do NOT book. ${details.error ?? 'Ask for another open day and time within this agent booking hours'}, then retry.`,
            };
          }
          return { ok: false, error: 'Failed to save demo lead without email', details };
        }
        let saved: { alreadyBooked?: boolean } = {};
        try {
          saved = (await res.json()) as { alreadyBooked?: boolean };
        } catch {
          /* ignore */
        }
        const alreadyBooked = saved.alreadyBooked === true;
        hooks?.onBookingSaved?.(preferred_time);
        return {
          ok: true,
          alreadyBooked,
          name: resolvedName,
          email_skipped: true,
          preferred_time,
          booking_type: resolvedBookingType,
          speak_as: policy.speakAs,
          ...(inventoryVerified !== undefined ? { inventory_verified: inventoryVerified } : {}),
          message: bookingSavedConfirmMessage(policy, {
            alreadyBooked,
            bookingType: resolvedBookingType,
          }),
        };
      },
    }),
    [PRODUCT_KNOWLEDGE_SEARCH_TOOL]: llm.tool({
      description: PRODUCT_KNOWLEDGE_SEARCH_TOOL_DESCRIPTION,
      parameters: z.object({
        query: z
          .string()
          .describe('Short English keyword query for the product detail the caller asked about'),
      }),
      execute: async ({ query }) => {
        const q = query?.trim();
        if (!q) return { ok: false, error: 'query is required' };
        const started = Date.now();
        try {
          const res = await apiFetch(`/api/simulator2/agents/${agentId}/knowledge-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q }),
            signal: AbortSignal.timeout(4_000),
          });
          const payload = (await res.json()) as Record<string, unknown>;
          console.info(
            '[vsa] search_product_knowledge',
            JSON.stringify({ q, found: payload.found, ms: Date.now() - started }),
          );
          return payload;
        } catch (err) {
          console.warn(
            '[vsa] search_product_knowledge failed:',
            err instanceof Error ? err.message : err,
          );
          return {
            ok: false,
            found: false,
            rule: 'Knowledge search is unavailable right now. Answer only from Product Knowledge in your instructions; if it is not there, offer a callback — never guess.',
          };
        }
      },
    }),
    update_demo_lead_name: llm.tool({
      description:
        'Update the lead name for this call AFTER booking was already saved, when the caller corrects a misheard name. Confirm the new name once (haan), then call this. Do not re-announce the full booking — one short ack is enough.',
      parameters: z.object({
        name: z.string().describe('Corrected full name'),
        name_confirmed: z
          .boolean()
          .optional()
          .describe('Set true after caller confirmed the corrected name read-back'),
      }),
      execute: async ({ name, name_confirmed }) => {
        const resolvedName = name?.trim();
        if (!resolvedName) {
          return { ok: false, error: 'Name is required', hint: 'Ask for the corrected name' };
        }
        if (!name_confirmed) {
          return {
            ok: false,
            error: 'Name not confirmed',
            hint: `Read back EXACTLY: "Maine suna ${resolvedName} — yeh sahi hai?" — get yes/haan, then retry with name_confirmed=true.`,
            readBackSpeech: `Maine suna ${resolvedName} — yeh sahi hai?`,
          };
        }
        if (!callId) {
          return {
            ok: false,
            error: 'No call id',
            hint: 'Acknowledge the corrected name verbally; cannot update lead without call id.',
          };
        }
        const res = await apiFetch(`/api/leads/by-call/${callId}/name`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, name: resolvedName }),
        });
        if (!res.ok) {
          let details: unknown;
          try {
            details = await res.json();
          } catch {
            details = undefined;
          }
          return { ok: false, error: 'Failed to update lead name', details };
        }
        return {
          ok: true,
          name: resolvedName,
          message: 'Lead name updated. Give one short ack — do not re-announce the full booking.',
        };
      },
    }),
    schedule_callback: llm.tool({
      description: knownPhone
        ? `Schedule a CALL-LATER callback only (busy now / call me later). NOT for product bookings (use capture_demo_lead). Call number on file: ${knownPhone}. Requires preferred_time.`
        : 'Schedule a CALL-LATER callback only when the user is busy or asked to be called later. Do NOT use this for product bookings — use capture_demo_lead instead. Requires preferred_time.',
      parameters: z.object({
        preferred_time: z.string(),
        name: knownName
          ? z.string().optional().describe(`Omit; use known name ${knownName}`)
          : z.string().optional(),
        phone: knownPhone
          ? z.string().optional().describe(`Omit unless alternate WhatsApp; known ${knownPhone}`)
          : z.string().optional(),
        email: knownEmail
          ? z.string().optional().describe(`Omit unless correcting; known ${knownEmail}`)
          : z.string().optional(),
        reason: z.string().optional(),
        phone_confirmed: z
          .boolean()
          .optional()
          .describe('Set true after caller confirmed phone read-back'),
      }),
      execute: async ({ preferred_time, name, phone, email, reason, phone_confirmed }) => {
        const resolvedName = name?.trim() || knownName;
        const resolvedPhone = phone?.trim() || knownPhone;

        if (resolvedPhone && !phone_confirmed && !knownPhone) {
          return {
            ok: false,
            error: 'Phone not confirmed',
            hint: 'Read back digits in groups (98-765-43210) and get yes before saving. If wrong, ask digit-by-digit.',
          };
        }

        let cleanedPhone: string | undefined;
        if (resolvedPhone) {
          const phoneCheck = validateLeadPhone(resolvedPhone);
          if (!phoneCheck.ok) {
            return {
              ok: false,
              error: phoneCheck.error,
              hint: phoneCheck.hint,
            };
          }
          cleanedPhone = phoneCheck.phone;
        }

        let normalizedEmail: string | undefined = knownEmail;
        if (email?.trim()) {
          const validated = validateLeadEmail(email);
          if (!validated.ok) {
            return {
              ok: false,
              error: validated.error,
              hint: validated.hint,
            };
          }
          normalizedEmail = validated.email;
        }

        const res = await apiFetch(`/api/leads/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            callId,
            preferredTime: preferred_time,
            name: resolvedName,
            phone: cleanedPhone,
            email: normalizedEmail,
            reason,
          }),
        });
        if (!res.ok) {
          let details: unknown;
          try {
            details = await res.json();
          } catch {
            details = undefined;
          }
          return {
            ok: false,
            error: 'Failed to schedule callback',
            details,
          };
        }
        return { ok: true, preferred_time };
      },
    }),
    ...(isNexoraHotelFactsConfigured() && policy.outcome === 'stay'
      ? {
          lookup_hotel_availability: llm.tool({
            description:
              'REQUIRED when the caller names a clear city and/or state (and again as they add date/room). Live Hotel inventory via progressive known filters. ' +
              'TOOL-FIRST: invoke this tool IMMEDIATELY with ZERO spoken audio first — no "That means check-in…", no weekday/month readback, no date narration before the result. ' +
              'Resolve relative dates silently into YYYY-MM-DD. Speak ONLY after the tool returns, and ONLY from say. ' +
              'Pass ONLY what they have said so far — never invent or send empty fields. ' +
              'Turn 1 state-only → state. Turn 2 city → city (+ state if already known). Turn 3 room → room_type or room_name. Turn 4 date → date. ' +
              'English values (ऋषिकेश→Rishikesh, उत्तराखंड→Uttarakhand). Do NOT invent state when only city was said. ' +
              'Do NOT call this for vague places (landmark/area/"pahad"/unclear) — first clarify nearest city or offer 2–3 city choices, then call with that city. ' +
              'Every new city / room / date = a NEW call with the growing known set. Speak ONLY from the tool result. ' +
              'Never invent beds/prices/room names (no Suite unless listed). Never deny a city from Product Knowledge alone. ' +
              'When ok:true, speak from say right after the result (short) — do NOT invent "call later", do NOT re-read the full list, do NOT re-confirm dates. ' +
              'When fallback_to_brain:true, never deny the city; never invent live beds/prices. ' +
              'MULTI-PROPERTY: if say asks which property, ask Hostel vs Resort — do NOT pitch dorm rates as the whole city. ' +
              'When they pick Resort / premium / Suite, call AGAIN with hotel_name (e.g. Resort) and room_type/room_name if named.',
            parameters: z.object({
              city: z
                .string()
                .optional()
                .describe(
                  'City in English when the caller named a city (Manali, Rishikesh, …). Omit if they only named a state.',
                ),
              state: z
                .string()
                .optional()
                .describe(
                  'State in English ONLY when the caller named a state (Uttarakhand, Rajasthan, …). Omit when they only named a city — do not invent/infer state.',
                ),
              hotel_name: z
                .string()
                .optional()
                .describe(
                  'Property lock when heard or after they pick: e.g. "Resort", "Hostel", or the full property name. Required on the second call for multi-property cities.',
                ),
              room_name: z
                .string()
                .optional()
                .describe(
                  'Room type(s) if named. One name, or several exact names joined by " + " / commas. Sent as known.room_type string[]. Never invent a single fake concatenated type.',
                ),
              room_type: z
                .string()
                .optional()
                .describe(
                  'Same as room_name — preferred field for known.room_type (one name or "A + B + C").',
                ),
              date: z
                .string()
                .optional()
                .describe(
                  'Stay date only after they named one (YYYY-MM-DD or as spoken). Omit until they give a date. Resolve relative dates silently — do not speak them before calling.',
                ),
              price_per_night: z
                .union([z.string(), z.number()])
                .optional()
                .describe(
                  'Only if they named a budget/price filter. Omit otherwise — never invent.',
                ),
            }),
            execute: async (raw) => {
              const args =
                typeof raw === 'object' && raw
                  ? (raw as {
                      city?: string;
                      state?: string;
                      hotel_name?: string;
                      room_name?: string;
                      room_type?: string;
                      date?: string;
                      price_per_night?: string | number;
                    })
                  : {};
              const asked = String(args.city?.trim() || args.hotel_name?.trim() || '');
              const explicitState = args.state?.trim() || '';
              const roomTypes = parseStayRoomTypeList(
                args.room_type?.trim() || args.room_name?.trim() || '',
              );
              const match = resolveHotelMatchForApi({
                city: asked || undefined,
                state: explicitState || undefined,
                hotel_name: args.hotel_name,
              });
              const query = match.city || asked;
              const started = Date.now();

              const lookupOpts = (signal: AbortSignal) => ({
                signal,
                // Only forward state when the model explicitly passed it.
                ...(match.state ? { state: match.state } : {}),
                ...(args.date?.trim() ? { date: args.date.trim() } : {}),
                ...(roomTypes.length ? { room_type: roomTypes } : {}),
                ...(args.price_per_night != null && String(args.price_per_night).trim()
                  ? { price_per_night: args.price_per_night }
                  : {}),
                prefer: {
                  ...(args.hotel_name?.trim() ? { hotel: args.hotel_name.trim() } : {}),
                  ...(roomTypes.length === 1
                    ? { room: roomTypes[0] }
                    : roomTypes.length > 1
                      ? { rooms: roomTypes, room: roomTypes[0] }
                      : {}),
                },
              });

              // Return immediately — never speak or waitForPlayout inside this tool.
              // A long-running tool + Gemini mid-speech is what used to abort the call.
              let result: Awaited<ReturnType<typeof queryNexoraHotelFacts>>;
              try {
                result = await queryNexoraHotelFacts(query, lookupOpts(AbortSignal.timeout(2_500)));
              } catch {
                result = await queryNexoraHotelFacts(
                  query,
                  lookupOpts(AbortSignal.timeout(2_000)),
                );
              }

              const compact = compactHotelFactsForLlm(result);
              if (typeof compact.say === 'string' && compact.say) {
                compact.say = lockSpokenHinglishGender(compact.say, agentGender);
              }
              const brainFallback = compact.fallback_to_brain === true;
              // Never speak inside this tool: return fast and let the model voice `say`.
              // If caller noise aborts a long-pending call, Gemini waits forever for its response.

              console.info(
                '[nexora] lookup_hotel_availability',
                JSON.stringify({
                  asked,
                  city: query || undefined,
                  state: match.state,
                  known: {
                    ...(match.state ? { state: match.state } : {}),
                    ...(query ? { city: query } : {}),
                    ...(roomTypes.length ? { room_type: roomTypes } : {}),
                    ...(args.date?.trim() ? { date: args.date.trim() } : {}),
                    ...(args.price_per_night != null &&
                    String(args.price_per_night).trim()
                      ? { price_per_night: args.price_per_night }
                      : {}),
                  },
                  ok: result.ok,
                  hotel: result.ok ? result.hotel_name : undefined,
                  matchedCity: result.ok ? result.city : undefined,
                  rooms: result.ok ? result.rooms.length : undefined,
                  policies: result.ok ? Object.keys(result.policies) : undefined,
                  fallback_to_brain: brainFallback || undefined,
                  error: result.ok ? undefined : result.error,
                  ms: Date.now() - started,
                }),
              );
              return compact;
            },
          }),
        }
      : {}),
  };
}
