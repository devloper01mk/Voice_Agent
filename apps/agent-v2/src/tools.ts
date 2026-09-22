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
} from '@vsa/shared';
import { llm } from '@livekit/agents';
import { z } from 'zod';
import {
  isNexoraHotelFactsConfigured,
  compactHotelFactsForLlm,
  resolveHotelMatchForApi,
  queryNexoraHotelFacts,
} from './nexora-hotel-facts.js';

const apiUrl = () => process.env.API_URL ?? 'http://localhost:3001';

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
                .describe('Room type they chose — re-checked live before save'),
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
            hint: `Read back EXACTLY: "${spokenPhoneForReadBack(resolvedPhone)}" — get yes/haan, then retry with phone_confirmed=true, name_confirmed=true, and email_skipped=true.`,
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

        const res = await fetch(`${apiUrl()}/api/leads`, {
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
        const res = await fetch(`${apiUrl()}/api/leads/by-call/${callId}/name`, {
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

        const res = await fetch(`${apiUrl()}/api/leads/callback`, {
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
              'REQUIRED when the caller names a clear city and/or state. Live inventory. ' +
              'Pass city only if they named a city; state only if they named a state; both if they named both. ' +
              'English values (ऋषिकेश→Rishikesh, उत्तराखंड→Uttarakhand). Do NOT invent state when only city was said. ' +
              'Do NOT call this for vague places (landmark/area/"pahad"/unclear) — first clarify nearest city or offer 2–3 city choices, then call with that city. ' +
              'Every different city = a NEW call. Speak ONLY from the tool result. ' +
              'Never invent beds/prices/room names (no Suite unless listed). Never deny a city from Product Knowledge alone. ' +
              'When ok:true, live rates are spoken — do NOT invent "call later" or re-read the full list. ' +
              'When fallback_to_brain:true, never deny the city; never invent live beds/prices. ' +
              'MULTI-PROPERTY: if say asks which property, ask Hostel vs Resort — do NOT pitch dorm rates as the whole city. ' +
              'When they pick Resort / premium / Suite, call AGAIN with hotel_name (e.g. Resort) and room_name if named.',
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
                  'Property lock when heard or after they pick: e.g. "Resort", "Hostel", or full "Moustache Rishikesh Resort". Required on the second call for multi-property cities.',
                ),
              room_name: z
                .string()
                .optional()
                .describe(
                  'Room type if they named one (Suite, Private Double Room, …). Prefer property that has this type.',
                ),
            }),
            execute: async (raw, opts) => {
              const args =
                typeof raw === 'object' && raw
                  ? (raw as {
                      city?: string;
                      state?: string;
                      hotel_name?: string;
                      room_name?: string;
                    })
                  : {};
              const asked = String(args.city?.trim() || args.hotel_name?.trim() || '');
              const explicitState = args.state?.trim() || '';
              const match = resolveHotelMatchForApi({
                city: asked || undefined,
                state: explicitState || undefined,
                hotel_name: args.hotel_name,
              });
              const query = match.city || asked;
              const started = Date.now();
              const ctx = opts?.ctx;
              const session = ctx?.session;

              const runLookup = async () =>
                queryNexoraHotelFacts(query, {
                  // Only forward state when the model explicitly passed it.
                  ...(match.state ? { state: match.state } : {}),
                  prefer: {
                    ...(args.hotel_name?.trim() ? { hotel: args.hotel_name.trim() } : {}),
                    ...(args.room_name?.trim() ? { room: args.room_name.trim() } : {}),
                  },
                });

              let result: Awaited<ReturnType<typeof queryNexoraHotelFacts>>;
              try {
                if (ctx && typeof ctx.filler === 'function') {
                  result = await ctx.filler(
                    lockSpokenHinglishGender(
                      'Ek second, live availability check karti hoon.',
                      agentGender,
                    ),
                    { delay: 0, maxSteps: 1 },
                    runLookup,
                  );
                } else {
                  result = await runLookup();
                }
              } catch {
                result = await runLookup();
              }

              const compact = compactHotelFactsForLlm(result);
              if (typeof compact.say === 'string' && compact.say) {
                compact.say = lockSpokenHinglishGender(compact.say, agentGender);
              }
              const brainFallback = compact.fallback_to_brain === true;
              const speakLine = result.ok
                ? lockSpokenHinglishGender(result.speak_now || result.spoken_hint || '', agentGender)
                : '';

              // Prefer generateReply on S2S (Gemini/OpenAI have no Cartesia TTS for session.say).
              // Gemini 3.1 cannot generateReply — then rely on speak_now in the tool JSON.
              let spoken = false;
              if (!brainFallback && session && speakLine.trim()) {
                const line = speakLine.trim();
                try {
                  if (typeof session.generateReply === 'function') {
                    const handle = session.generateReply({
                      instructions:
                        `Speak this live availability to the caller now in 1–2 short sentences. ` +
                        `Do not call tools. Do not invent beds/prices beyond this: ${line}`,
                      toolChoice: 'none',
                      allowInterruptions: true,
                    });
                    await handle.waitForPlayout();
                    spoken = true;
                  }
                } catch (err) {
                  console.warn(
                    '[nexora] generateReply speak failed (will rely on tool JSON speak_now)',
                    err instanceof Error ? err.message : err,
                  );
                }
                if (!spoken && typeof session.say === 'function') {
                  try {
                    const handle = session.say(line, { allowInterruptions: true });
                    await handle.waitForPlayout();
                    spoken = true;
                  } catch (err) {
                    console.warn(
                      '[nexora] force-speak failed',
                      err instanceof Error ? err.message : err,
                    );
                  }
                }
              }

              console.info(
                '[nexora] lookup_hotel_availability',
                JSON.stringify({
                  asked,
                  city: query || undefined,
                  state: match.state,
                  match: {
                    ...(query ? { city: [query] } : {}),
                    ...(match.state ? { state: [match.state] } : {}),
                  },
                  ok: result.ok,
                  hotel: result.ok ? result.hotel_name : undefined,
                  matchedCity: result.ok ? result.city : undefined,
                  rooms: result.ok ? result.rooms.length : undefined,
                  policies: result.ok ? Object.keys(result.policies) : undefined,
                  spoken: spoken || (Boolean(speakLine.trim()) && !brainFallback),
                  forceSpoken: spoken,
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
