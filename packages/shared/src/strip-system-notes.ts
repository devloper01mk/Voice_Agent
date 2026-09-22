/**
 * Remove LLM-only `[System: …]` / `[SYSTEM: …]` guidance injected onto user turns
 * so transcripts / Simulator chat show the caller's words only.
 */
export function stripSystemNotesForDisplay(text: string): string {
  if (!text) return text;
  return text
    // Case-insensitive: email/phone notes use "[System:", language notes use "[SYSTEM:".
    .replace(/\s*\[System:[^\]]*\]/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Gemini Live sometimes leaks tool-parse failures into output transcription
 * (e.g. after end_call when speech is mixed into the tool channel).
 * Strip those so callers / Simulator never see or "hear" them as agent lines.
 */
export function stripAgentToolNoiseForDisplay(text: string): string {
  if (!text) return text;
  let out = text;
  // Full Gemini / LiveKit recovery blobs glued after a normal goodbye.
  out = out.replace(
    /\s*The previous function call could not be parsed[\s\S]*?(?=(?:\n[A-Z]|$))/gi,
    '',
  );
  out = out.replace(/\s*ParsingError:\s*Failed to parse function call[\s\S]*?(?=(?:\n[A-Z]|$))/gi, '');
  out = out.replace(
    /\s*Fix the function call syntax to match the expected format\.?/gi,
    '',
  );
  out = out.replace(
    /\s*Function call is missing the required ['"]?call:['"]? prefix\.?/gi,
    '',
  );
  out = out.replace(/\s*Got:\s*['"]?Text being parsed is:[\s\S]*$/gi, '');
  out = out.replace(/\s*Text being parsed is:\s*['"]?[\s\S]*$/gi, '');
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export type HistoryMessageForSanitize = {
  role: string;
  content?: string;
};

/**
 * Strip `[System:]` notes from prior user turns. Keep the latest user turn intact
 * so the current notepad still reaches the LLM.
 */
export function sanitizeSpokenHistoryForLlm<T extends HistoryMessageForSanitize>(
  history: T[],
): T[] {
  let lastUser = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === 'user') {
      lastUser = i;
      break;
    }
  }
  return history.map((message, index) => {
    if (message.role !== 'user' || index === lastUser) return message;
    const content = message.content;
    if (typeof content !== 'string' || !content) return message;
    const stripped = stripSystemNotesForDisplay(content);
    if (stripped === content) return message;
    return { ...message, content: stripped };
  });
}
