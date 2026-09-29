import type { voice } from '@livekit/agents';

/**
 * Speak a fixed line. Gemini Live sessions have no separate TTS, so `session.say()`
 * throws there — ask the realtime model to voice it first, and fall back to `say()`
 * for sessions that do have a TTS (or models that cannot generateReply).
 * Realtime generateReply must keep allowInterruptions:true (server VAD).
 */
export async function speakLine(
  session: voice.AgentSession,
  line: string,
  opts?: { allowInterruptions?: boolean },
): Promise<boolean> {
  const text = line.trim();
  if (!text) return false;
  try {
    await session
      .generateReply({
        instructions: `Say exactly this to the caller, verbatim, and nothing else: "${text}"`,
        toolChoice: 'none',
        allowInterruptions: true,
      })
      .waitForPlayout();
    return true;
  } catch (err) {
    console.warn('[vsa] generateReply speak failed, trying say():', err instanceof Error ? err.message : err);
  }
  try {
    await session.say(text, { allowInterruptions: opts?.allowInterruptions ?? true }).waitForPlayout();
    return true;
  } catch (err) {
    console.warn('[vsa] say() failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
