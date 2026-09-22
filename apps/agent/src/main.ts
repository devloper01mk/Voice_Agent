import 'dotenv/config';
import { ServerOptions, cli, defineAgent, voice } from '@livekit/agents';
import { buildOutboundOpenerInstructions, parseVoiceLanguages } from '@vsa/shared';
import { fileURLToPath } from 'node:url';
import { probeAzureSpeechKey } from './azure-stt.js';
import { attachCallTelemetry, publishCallError } from './call-telemetry.js';
import { attachCallTranscriptPersist } from './call-transcript.js';
import { attachSilenceWatchdog } from './silence-watchdog.js';
import { createCallVad } from './call-vad.js';
import { getLatencyConfig } from './latency-profile.js';
import { resolveAgentFromRoom } from './load-agent.js';
import { resolveNoiseCancellation } from './noise-cancellation.js';
import { createStt } from './stt-factory.js';
import { createVoiceAgent } from './voice-agent.js';

export default defineAgent({
  entry: async (ctx) => {
    try {
      await ctx.connect();

      const participant = await ctx.waitForParticipant();

      const { agent, callId, direction, prospectName, contactPhone, contactEmail } =
        await resolveAgentFromRoom(
        ctx.room.name ?? '',
        ctx.room.metadata,
        participant.metadata,
      );

      const speakLanguages = parseVoiceLanguages(agent.voiceLanguages);
      const latency = getLatencyConfig();
      const vad = createCallVad(latency.vad);

      const session = new voice.AgentSession({
        stt: createStt(agent, {
          languages: speakLanguages,
          sampleRate: 16000,
          onError: (message) => publishCallError(ctx.room, message, 'stt'),
          vad,
        }),
        vad,
        turnHandling: {
          turnDetection: 'vad',
          endpointing: latency.endpointing,
          preemptiveGeneration: { enabled: latency.preemptiveGeneration },
          interruption: {
            minDuration: latency.interruption.minDuration,
            minWords: latency.interruption.minWords,
            // Cut on barge-in — do not pause then resume mid-sentence (sounds stuck).
            resumeFalseInterruption: false,
            falseInterruptionTimeout: 2500,
          },
        },
        ttsReadIdleTimeout: 20_000,
      });

      const voiceAgent = createVoiceAgent(
        agent,
        callId,
        direction,
        prospectName,
        contactPhone,
        contactEmail,
        ctx.room,
      );

      await session.start({
        agent: voiceAgent,
        room: ctx.room,
        inputOptions: {
          audioSampleRate: 16000,
          audioNumChannels: 1,
          noiseCancellation: resolveNoiseCancellation(),
          // Off-topic wrap / end_call shutdown should disconnect the simulator UI too.
          deleteRoomOnClose: true,
        },
      });

      attachCallTelemetry(session, ctx.room);
      attachCallTranscriptPersist(session, ctx.room, callId);
      attachSilenceWatchdog(session, agent.skillsConfig);

      if (direction === 'outbound') {
        await session
          .generateReply({
            instructions: buildOutboundOpenerInstructions(agent, prospectName),
            allowInterruptions: false,
            toolChoice: 'none',
          })
          .waitForPlayout();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      publishCallError(ctx.room, message, 'agent');
      throw err;
    }
  },
});

async function boot() {
  try {
    await probeAzureSpeechKey();
    console.info('[vsa] Azure Speech key OK — Azure STT ready');
  } catch (err) {
    console.warn(
      '[vsa] Azure Speech not ready — agents using Azure STT will not hear callers until AZURE_SPEECH_KEY is fixed:',
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.warn(
      '[vsa] OPENAI_API_KEY missing — agents using OpenAI STT (or GPT LLM) will fail until it is set',
    );
  } else {
    console.info('[vsa] OPENAI_API_KEY present — OpenAI STT available');
  }

  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: 'voice-sales-agent',
    }),
  );
}

void boot();
