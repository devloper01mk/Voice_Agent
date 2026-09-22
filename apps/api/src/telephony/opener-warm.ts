import { streamMulaw8kFrames } from './cartesia-telephony-tts.js';
import type { RuntimeAgentPayload } from './llm-client.js';
import { resolveSimulator2TtsEmotion } from '@vsa/shared';
import { isFastOpenerEnabled, resolveScriptedOpener } from './telephony-opener.js';

let warmCallId: string | null = null;
let warmFrames: Array<Buffer> | null = null;
let warmPromise: Promise<Array<Buffer> | null> | null = null;

/** Synthesize Studio greeting μ-law while the phone is still ringing. */
export function warmOutboundOpener(
  callId: string,
  agentPromise: Promise<RuntimeAgentPayload>,
  prospectName?: string,
): void {
  if (!isFastOpenerEnabled()) return;
  warmCallId = callId;
  warmFrames = null;
  warmPromise = agentPromise
    .then(async (agent) => {
      if (warmCallId !== callId || !agent.greeting?.trim()) return null;
      const text = resolveScriptedOpener(agent, prospectName);
      const frames: Buffer[] = [];
      await streamMulaw8kFrames(
        {
          text,
          voiceId: agent.voiceId,
          voiceLanguages: agent.voiceLanguages,
          speed: agent.voiceSpeed,
          pitch: agent.voicePitch,
          modelId: agent.ttsModel,
          sampleRate: agent.ttsSampleRate,
          emotion: resolveSimulator2TtsEmotion(agent.ttsEmotion),
          agentGender: agent.agentGender,
        },
        async (frame) => {
          frames.push(Buffer.from(frame));
          return true;
        },
      );
      if (warmCallId !== callId) return null;
      warmFrames = frames;
      return frames;
    })
    .catch(() => null);
}

export function takeWarmedOpenerFrames(callId: string): Array<Buffer> | null {
  if (warmCallId !== callId || !warmFrames?.length) return null;
  warmCallId = null;
  const frames = warmFrames;
  warmFrames = null;
  warmPromise = null;
  return frames;
}

export async function awaitWarmedOpenerFrames(
  callId: string,
  maxWaitMs = 400,
): Promise<Array<Buffer> | null> {
  const ready = takeWarmedOpenerFrames(callId);
  if (ready?.length) return ready;
  if (!warmPromise || warmCallId !== callId) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), maxWaitMs));
  const frames = await Promise.race([warmPromise, timeout]);
  if (Array.isArray(frames) && frames.length > 0 && warmCallId === callId) {
    warmCallId = null;
    warmFrames = null;
    warmPromise = null;
    return frames;
  }
  return takeWarmedOpenerFrames(callId);
}

export function dropWarmedOpener(callId: string): void {
  if (warmCallId !== callId) return;
  warmCallId = null;
  warmFrames = null;
  warmPromise = null;
}
