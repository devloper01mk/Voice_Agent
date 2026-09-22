import { buildCallerGenderPromptLine } from './caller-gender.js';

export type CallDirection = 'inbound' | 'outbound';

export interface KnownContactProfile {
  name?: string;
  phone?: string;
  email?: string;
  whatsappPhone?: string;
}

export function mergeKnownContact(
  ...sources: Array<KnownContactProfile | null | undefined>
): KnownContactProfile {
  const result: KnownContactProfile = {};
  for (const src of sources) {
    if (!src) continue;
    if (src.name?.trim()) result.name = src.name.trim();
    if (src.phone?.trim()) result.phone = src.phone.trim();
    if (src.email?.trim()) result.email = src.email.trim();
    if (src.whatsappPhone?.trim()) result.whatsappPhone = src.whatsappPhone.trim();
  }
  return result;
}

export function hasKnownContactField(profile: KnownContactProfile): boolean {
  return Boolean(profile.name || profile.phone || profile.email || profile.whatsappPhone);
}

export function buildCallerContextPrompt(
  profile: KnownContactProfile,
  direction: CallDirection,
): string {
  if (!hasKnownContactField(profile)) return '';

  const lines: string[] = ['## Known contact (do NOT re-collect)'];
  if (profile.name) {
    lines.push(`- Name: ${profile.name}`);
    lines.push(
      '- Do NOT ask "aapka naam kya hai", "may I know your name", or similar. Address them by name.',
    );
    lines.push(buildCallerGenderPromptLine(profile.name));
  }
  if (profile.phone) {
    lines.push(`- Call number: ${profile.phone}`);
    lines.push('- Do NOT ask for their phone number from scratch.');
    lines.push(
      '- For WhatsApp/follow-up: ask ONLY if this number is on WhatsApp. If they say no, ask for alternate WhatsApp number.',
    );
  }
  if (profile.email) {
    lines.push(`- Email on file: ${profile.email}`);
    lines.push(
      `- Do NOT ask "what is your email". Read back and confirm: "Mere paas ${profile.email} hai — sahi hai?"`,
    );
  }
  if (profile.whatsappPhone && profile.whatsappPhone !== profile.phone) {
    lines.push(`- WhatsApp number: ${profile.whatsappPhone}`);
  }

  if (direction === 'outbound' && profile.name) {
    lines.push(
      `- OUTBOUND: You called ${profile.name}. Open with their name, your company, and WHY you called (follow-up / help them choose). Do not re-ask identity after they say hello/haan. "Call kyon kiya" = restate purpose and continue — never hang up.`,
    );
  }

  lines.push(
    '- Collect ONLY fields not listed above. preferred_time for demo/callback is usually still needed.',
  );
  return lines.join('\n');
}

export function buildDemoKnownContactRules(profile: KnownContactProfile): string {
  if (!hasKnownContactField(profile)) return '';

  const skips: string[] = [];
  if (profile.name) skips.push('name (use known name in capture_demo_lead tool)');
  if (profile.email) skips.push('email (read-back confirm only, do not ask from scratch)');
  if (profile.phone) skips.push('phone (WhatsApp verify only)');

  return `## DEMO booking override
- Known contact fields on this call: ${skips.join('; ')}.
- Skip collection for known fields. Collect only missing fields, one at a time.
- Always collect preferred_time unless the caller already stated it this call.`;
}
