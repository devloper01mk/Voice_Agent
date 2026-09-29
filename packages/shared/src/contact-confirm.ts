import {
  digitsToWords,
  formatPhoneForSpeech,
  type PhoneSpeechLocale,
} from './phone-utils.js';

export interface ContactConfirmSkills {
  demo?: {
    nameConfirmTemplate?: string;
    nameSpellRetryTemplate?: string;
    phoneConfirmTemplate?: string;
    phoneSpellRetryTemplate?: string;
  };
}

/** Expand digit runs in text to English digit words (1934 → "one nine three four"). */
export function expandDigitsToEnglishWords(text: string): string {
  return text
    .replace(/\d+/g, (run, offset, full) => {
      const words = digitsToWords(run, 'en');
      const prev = offset > 0 ? full[offset - 1] : '';
      const next = full[offset + run.length] ?? '';
      const lead = prev && /[A-Za-z]/.test(prev) ? ' ' : '';
      const trail = next && /[A-Za-z]/.test(next) ? ' ' : '';
      return `${lead}${words}${trail}`;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildContactConfirmPrompt(_skills: ContactConfirmSkills): string {
  return `## Name and phone confirmation (tool safety)
- These rules apply **when the caller already wants to book** (the save outcome in Booking policy). They are not a required conversation path for every call.
- NEVER call capture_demo_lead or save a phone on the first utterance alone — read back and get explicit yes/haan/sahi hai first.
- NEVER announce a booking as done until capture_demo_lead returns ok:true — even if preferred_time is already known.
- Collect only missing fields. Typical order when booking: preferred_time → full name (confirm) → phone (confirm) → save. Skip any field already on Known contact or in CALL FACTS.
- **Never ask for email** on bookings unless Booking policy requires it. After phone yes/haan, call capture_demo_lead with email_skipped=true, name_confirmed=true, and phone_confirmed=true.
- When a SYSTEM note or tool returns a phone read-back string, speak those English digit words **VERBATIM** — do not paraphrase, regroup, skip, or invent digits. Surrounding sentence stays call language.
- On "X nahi Y" / galat: take Y only and re-confirm. Never invent digits to force length 10.
- Keep partial digits across turns; ask only for the rest. Do not wipe the notepad and demand a full re-say as the default.
- After a booking is already saved: name corrections use update_demo_lead_name. Do not recapture unless they ask to change the time. Restate the saved details and that the payment link will go on WhatsApp, then stay on the line. end_call only when they say thank you, bye, or bas. If no booking was saved this call, never invent a slot.
- If they say name was not asked, apologize briefly, ask name, confirm, and update if already saved.

### Number speech
- **Price / amount / time / weight / height / age:** natural language matching the call.
- **Phone, OTP, PIN:** ALWAYS English digit words one-by-one or in pairs ("two two", "two three"), even on a Hinglish call.
- **Never say "double" or "triple"** for phone/OTP/PIN. Forbidden: "double two", "triple two", "double three". Correct: "two two" for 22; a single 3 is only "three".`;
}

/**
 * Phone read-back for confirmation. Identifier digits always use English words
 * (even when the surrounding call is Hinglish).
 */
export function spokenPhoneForReadBack(
  phone: string,
  _locale: PhoneSpeechLocale = 'en',
): string {
  return formatPhoneForSpeech(phone, 'en');
}
