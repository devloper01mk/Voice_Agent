import {
  formatSpokenSlotAlternatives,
  spokenPhoneForReadBack,
  validateLeadEmail,
  validateLeadPhone,
  type KnownContactProfile,
} from '@vsa/shared';
import { llm } from '@livekit/agents';
import { z } from 'zod';

const apiUrl = () => process.env.API_URL ?? 'http://localhost:3001';

export type LeadToolHooks = {
  onBookingSaved?: (preferredTime: string) => void;
};

export function createTools(
  agentId: string,
  callId?: string,
  knownContact?: KnownContactProfile,
  hooks?: LeadToolHooks,
) {
  const knownName = knownContact?.name?.trim();
  const knownEmail = knownContact?.email?.trim();
  const knownPhone = knownContact?.phone?.trim();

  return {
    capture_demo_lead: llm.tool({
      description: knownName
        ? `Save a booking (demo / test_drive / showroom_visit / simulator). Name on file: ${knownName} — do not ask for name again. NEVER ask for email. Contact order: preferred_time → phone (confirm) → save with email_skipped=true. Requires preferred time and confirmed phone. Use booking_type=showroom_visit or test_drive when that is what they booked. Only call after phone read-back yes/haan. NEVER use schedule_callback for visits.`
        : 'Save a booking after the user agreed: demo, test_drive, showroom_visit, or simulator. Set booking_type accordingly. Contact order: preferred_time → name (read-back confirm) → phone (confirm) → save with email_skipped=true, name_confirmed=true, phone_confirmed=true. NEVER ask for email. NEVER use schedule_callback for showroom/test-drive/demo visits — only capture_demo_lead. Only call after name and phone confirmation.',
      parameters: z.object({
        name: knownName
          ? z
              .string()
              .optional()
              .describe(`Lead full name — omit; use known name ${knownName}`)
          : z.string().describe('Lead full name'),
        preferred_time: z.string().describe('When they want the demo'),
        phone: z.string().optional().describe('WhatsApp number if different from call number'),
        notes: z.string().optional(),
        booking_type: z
          .enum(['demo', 'test_drive', 'simulator', 'showroom_visit'])
          .optional()
          .describe('demo | test_drive | simulator | showroom_visit — use test_drive for car test drives'),
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
      }),
      execute: async ({
        name,
        preferred_time,
        phone,
        notes,
        booking_type,
        name_confirmed,
        phone_confirmed,
      }) => {
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
            bookingType: booking_type ?? 'demo',
            productInterest: notes,
            notes: notes ? `${notes} | email skipped on call` : 'email skipped on call',
          }),
        });
        if (!res.ok) {
          let details: {
            error?: string;
            alternatives?: { start: string; end: string }[];
          } = {};
          try {
            details = (await res.json()) as typeof details;
          } catch {
            /* ignore */
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
          booking_type: booking_type ?? 'demo',
          message: alreadyBooked
            ? 'Already saved this call. Restate the same slot. Do not say it is full. Then end_call.'
            : 'Lead saved. You may now tell the caller the booking is confirmed.',
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
        ? `Schedule a CALL-LATER callback only (busy now / call me later). NOT for showroom visit, test drive, demo, or simulator — those must use capture_demo_lead with booking_type. Call number on file: ${knownPhone}. Requires preferred_time.`
        : 'Schedule a CALL-LATER callback only when the user is busy or asked to be called later. Do NOT use this for showroom visit / test drive / demo / simulator bookings — use capture_demo_lead with booking_type instead. Requires preferred_time.',
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
  };
}
