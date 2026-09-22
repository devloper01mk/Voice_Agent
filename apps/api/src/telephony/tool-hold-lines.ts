import { lockSpokenHinglishGender, type SkillsConfig } from '@vsa/shared';

export const TOOL_HOLD_TOOLS = new Set([
  'capture_demo_lead',
  'schedule_callback',
  'update_demo_lead_name',
  // lookup_hotel_availability: no hold — filler + waitForPlayback added ~2–3s before Nexora.
]);

const DEFAULT_LINES: Record<string, string> = {
  capture_demo_lead: 'Ek second, main note kar rahi hoon.',
  schedule_callback: 'Theek hai, main callback schedule kar rahi hoon.',
  update_demo_lead_name: 'Ji, main naam update kar rahi hoon.',
};

export function isToolHoldEnabled(): boolean {
  const raw = process.env.TELEPHONY_TOOL_HOLD?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return true;
}

export function resolveToolHoldLine(
  toolName: string,
  opts?: { agentGender?: string; skills?: SkillsConfig | null },
): string | null {
  if (!TOOL_HOLD_TOOLS.has(toolName)) return null;

  const custom = opts?.skills?.runtime?.toolHoldLines?.[toolName]?.trim();
  let line = custom || DEFAULT_LINES[toolName];
  if (!line) return null;

  return lockSpokenHinglishGender(line, opts?.agentGender);
}
