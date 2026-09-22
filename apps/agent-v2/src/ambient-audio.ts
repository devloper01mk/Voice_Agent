/**
 * Soft call-center room tone for Simulator 2.0 — separate background_audio track,
 * independent of Cartesia / OpenAI Realtime TTS.
 */
import { voice } from '@livekit/agents';
import type { Room } from '@livekit/rtc-node';

export const SIMULATOR2_AMBIENT_VOLUME = 0.12;

export const SIMULATOR2_AMBIENT_CLIP = voice.BuiltinAudioClip.OFFICE_AMBIENCE;

export function buildSimulator2AmbientOptions(): voice.BackgroundAudioPlayerOptions {
  return {
    ambientSound: {
      source: SIMULATOR2_AMBIENT_CLIP,
      volume: SIMULATOR2_AMBIENT_VOLUME,
    },
  };
}

export async function startAmbientAudio(
  room: Room,
  agentSession: voice.AgentSession,
): Promise<voice.BackgroundAudioPlayer> {
  const player = new voice.BackgroundAudioPlayer(buildSimulator2AmbientOptions());
  await player.start({ room, agentSession });
  return player;
}
