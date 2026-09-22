import { lockSpokenHinglishGender } from '@vsa/shared';
import type { RuntimeAgentPayload } from './llm-client.js';

export function isFastOpenerEnabled(): boolean {
  const raw = process.env.TELEPHONY_FAST_OPENER?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return true;
}

/** When false, outbound plays the scripted greeting immediately after connect (no AMD wait). */
export function shouldWaitForAmdBeforeOpener(agent: Pick<RuntimeAgentPayload, 'greeting'>): boolean {
  const raw = process.env.TELEPHONY_AMD_BEFORE_OPENER?.trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  if (isFastOpenerEnabled() && agent.greeting?.trim()) return false;
  return true;
}

/** Studio greeting as spoken opener — skips LLM on connect for lower pickup latency. */
export function resolveScriptedOpener(
  agent: RuntimeAgentPayload,
  prospectName?: string,
): string {
  const prospect = prospectName?.trim();
  let text =
    agent.greeting?.trim() ||
    `Hi, main ${agent.name} bol rahi hoon ${agent.productName} se. Aaj aap kya dekhna chahenge?`;
  text = text
    .replaceAll('{agent_name}', agent.name)
    .replaceAll('{product_name}', agent.productName)
    .replaceAll('{prospect_name}', prospect ?? '');
  if (prospect && !/\{prospect_name\}/i.test(agent.greeting ?? '')) {
    if (!new RegExp(prospect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
      text = `Hi ${prospect}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    }
  }
  return lockSpokenHinglishGender(text.trim(), agent.agentGender);
}
