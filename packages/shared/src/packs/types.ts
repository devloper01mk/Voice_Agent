/**
 * Integration pack = code that a live system genuinely needs (tool guidance, per-turn
 * prefetch). All selling behaviour lives in the per-agent Sales playbook (data), not here.
 */

export type PackId = 'generic' | 'hotel_stay';

export interface PackTurnInput {
  /** Caller utterance after STT correction. */
  text: string;
  productName: string;
  /** Caller is asking for an answer first — do not force tool flows this turn. */
  answerFirst: boolean;
}

export interface VerticalPack {
  id: PackId;
  label: string;
  description: string;
  /** Extra bullets inside "## Tools" (e.g. live inventory tool usage). */
  toolRules: string;
  /** Extra lines for the Gemini Live S2S supplement. */
  s2sRules: string[];
  /** Extra end_call guidance lines. */
  endCallRules: string[];
  /**
   * Optional per-turn system note (e.g. live lookup prefetch). Return null to fall
   * back to the core product-question handling.
   */
  turnNote?: (input: PackTurnInput) => Promise<string | null>;
}
