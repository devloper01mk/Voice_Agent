/**
 * Shared delivery rules. Kept as a named export so Simulator 2.0 files do not drift.
 */
import { buildAgentDeliveryPrompt } from './natural-speech.js';

export function buildSimulator2NaturalVoicePrompt(): string {
  return buildAgentDeliveryPrompt();
}
