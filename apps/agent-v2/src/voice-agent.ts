import { beta, voice } from '@livekit/agents';
import type { Room } from '@livekit/rtc-node';
import {
  buildGeminiLiveS2sInstructionSupplement,
  buildRealtimeS2sInstructionSupplement,
  buildSimulator2Instructions,
  appendHinglishGenderLock,
  isFemaleGeminiLiveVoice,
  isFemaleRealtimeVoice,
  isGeminiLivePipeline,
  isOpenaiRealtimePipeline,
  mergeSkillsConfig,
  normalizeRealtimeS2sUserConfig,
  resolveSimulator2TtsEmotion,
  SIMULATOR2_DEFAULT_TTS_EMOTION,
  type CallDirection,
  productKnowledgeFromSources,
} from '@vsa/shared';
import type { RuntimeAgent } from './load-agent.js';
import { createGeminiLiveModel } from './gemini-live-factory.js';
import { createLlm } from './llm-factory.js';
import { createMultilingualCartesiaTts } from './multilingual-tts.js';
import { createRealtimeModel } from './realtime-factory.js';
import { createTools } from './tools.js';
import { createUserTurnHandler, type BookingLockBox } from './user-turn-handler.js';

export { resolveSimulator2TtsEmotion, SIMULATOR2_DEFAULT_TTS_EMOTION };

const END_CALL_EXTRA = `
Also call end_call when:
- Off-topic / irrelevant chat hit the redirect limit (after short product redirects).
- Timepass / casual banter hit the casual-turn limit.
- Caller is not interested and you have given the polite close.

Never call end_call when the caller asks who you are or why you called — restate purpose and continue.
Never call end_call when they choose a listed offering or ask what you want them to do — recommend from Product Knowledge and offer the next step.
Never announce a booking time or “noted” slot unless capture_demo_lead already returned ok:true.
Never say “booking confirm ho gayi/gaya” or that the slot is locked unless that tool returned ok:true.
If the caller asks a product question, answer it — do not demand name/phone first.
If lookup_hotel_availability is available, call it for every clear city (and/or state) the caller names — pass city in English (मनाली→Manali, आगरा→Agra). 
**Brain + live:** existence/rates from live lookup; sales vibe from Product Knowledge only if it does not contradict live. Never deny a city from Product Knowledge alone.
Every different city = a new tool call. Never volunteer a destination city they did not name (except 2–3 short choices when clarifying a vague place).
Vague place (landmark, area, “pahad”, “Taj ke paas”, not a clear city/state): do NOT call lookup yet. Salesperson style — acknowledge, map to nearest city or offer 2–3 city options, then lookup after they pick. Never invent rates; never say a dry “inventory nahi ho rahi” for an unclear place.
Sales tease (vibe / premium feel) is OK; NEVER invent Suite / bed counts / prices unless that exact row is in the latest lookup result.
Multi-property city (Hostel + Resort): if the tool asks which property, ask — do NOT dump Hostel dorm rates as the whole city. After they pick Resort/premium/Suite, call lookup AGAIN with hotel_name (e.g. Resort) and room_name if named.
If lookup_hotel_availability returns fallback_to_brain:true, never deny the city; still never invent live beds/prices; offer retry/callback for rates.
If a SYSTEM note already has LIVE LOOKUP JSON for a city, speak from that JSON + Brain tone — do not say nahi hai from memory.
Before capture_demo_lead for a stay, pass city and room_name when known — the server re-checks live inventory; if sold out, offer alternatives and do not say booking confirmed.
**Hangup order (critical for Gemini Live):** (1) Speak a short warm goodbye in sticky call language as AUDIO only. (2) Then invoke end_call as a pure tool with empty args. NEVER put spoken words (Theek hai, Bye, Thik hai, etc.) inside the tool call. Do not narrate the tool.
Do not keep chatting after the wrap limit.
`;

function toolsWithEndCall(
  agentId: string,
  callId: string | undefined,
  knownContact: Parameters<typeof createTools>[2],
  hooks?: Parameters<typeof createTools>[3],
  bookingPolicy?: Parameters<typeof createTools>[4],
  agentGender?: string,
) {
  const base = createTools(agentId, callId, knownContact, hooks, bookingPolicy, agentGender);
  return [
    ...Object.entries(base).map(([name, toolDef]) => ({
      ...toolDef,
      id: name,
      name,
    })),
    beta.createEndCallTool({
      extraDescription: END_CALL_EXTRA,
      deleteRoom: true,
      // Goodbye must already be spoken before the tool. Asking Gemini to speak again
      // after end_call makes it mix Hinglish into the tool channel → parse errors.
      endInstructions: null,
    }),
  ];
}

function buildInstructions(
  agent: RuntimeAgent,
  direction: CallDirection,
  prospectName?: string,
  contactPhone?: string,
  contactEmail?: string,
) {
  const skills = mergeSkillsConfig(agent.skillsConfig);
  const { instructions, knownContact } = buildSimulator2Instructions({
    agent,
    direction,
    prospectName,
    contactPhone,
    contactEmail,
    skills,
  });
  return { instructions, skills, knownContact };
}

export function createVoiceAgent(
  agent: RuntimeAgent,
  callId?: string,
  direction: CallDirection = 'inbound',
  prospectName?: string,
  contactPhone?: string,
  contactEmail?: string,
  _room?: Room,
  opts?: { telephony?: boolean },
) {
  const telephony = Boolean(opts?.telephony);
  const s2sVoice = agent.realtimeS2sConfig?.voice ?? agent.realtimeVoice;
  const agentGender =
    (isGeminiLivePipeline(agent.voicePipeline) && isFemaleGeminiLiveVoice(s2sVoice)) ||
    (isOpenaiRealtimePipeline(agent.voicePipeline) && isFemaleRealtimeVoice(s2sVoice))
      ? 'female'
      : agent.agentGender === 'male'
        ? 'male'
        : 'female';
  const { instructions, skills, knownContact } = buildInstructions(
    agent,
    direction,
    prospectName,
    contactPhone,
    contactEmail,
  );

  const bookingLock: BookingLockBox = { saved: false };
  const tools = toolsWithEndCall(
    agent.id,
    callId,
    knownContact,
    {
      onBookingSaved: (preferredTime) => {
        bookingLock.saved = true;
        bookingLock.preferredTime = preferredTime;
      },
    },
    skills.booking,
    agentGender,
  );

  const turnOpts = {
    productName: agent.productName,
    skillsConfig: skills,
    agentId: agent.id,
    direction,
    productKnowledge: productKnowledgeFromSources(agent.brainSummary, agent.compiledSystemPrompt),
    bookingLock,
    hasConsumedLeadHistory: Boolean(agent.hasConsumedLeadHistory),
    agentGender,
    contactName: prospectName,
  };

  if (isOpenaiRealtimePipeline(agent.voicePipeline)) {
    const handleUserTurn = createUserTurnHandler({
      ...turnOpts,
      onLanguageLockChange: () => {},
    });
    const s2sConfig =
      agent.realtimeS2sConfig ??
      normalizeRealtimeS2sUserConfig({ voice: agent.realtimeVoice }, 'openai_realtime');
    const agentForInstructions =
      isFemaleRealtimeVoice(s2sConfig.voice) && agent.agentGender !== 'female'
        ? { ...agent, agentGender: 'female' as const }
        : agent;
    const { instructions: s2sBaseInstructions } = buildInstructions(
      agentForInstructions,
      direction,
      prospectName,
      contactPhone,
      contactEmail,
    );
    const s2sInstructions = appendHinglishGenderLock(
      `${s2sBaseInstructions}${buildRealtimeS2sInstructionSupplement(s2sConfig.voice)}`,
      agentForInstructions.agentGender,
    );

    return voice.Agent.create({
      instructions: s2sInstructions,
      llm: createRealtimeModel({
        speed: agent.voiceSpeed,
        s2sConfig,
      }),
      tools,
      onUserTurnCompleted: handleUserTurn,
    });
  }

  if (isGeminiLivePipeline(agent.voicePipeline)) {
    const handleUserTurn = createUserTurnHandler({
      ...turnOpts,
      onLanguageLockChange: () => {},
    });
    const s2sConfig =
      agent.realtimeS2sConfig ??
      normalizeRealtimeS2sUserConfig({ voice: agent.realtimeVoice }, 'gemini_live');
    const agentForInstructions =
      isFemaleGeminiLiveVoice(s2sConfig.voice) && agent.agentGender !== 'female'
        ? { ...agent, agentGender: 'female' as const }
        : agent;
    const { instructions: s2sBaseInstructions } = buildInstructions(
      agentForInstructions,
      direction,
      prospectName,
      contactPhone,
      contactEmail,
    );
    const s2sInstructions = appendHinglishGenderLock(
      `${s2sBaseInstructions}${buildGeminiLiveS2sInstructionSupplement(s2sConfig.voice, s2sConfig.model)}`,
      agentForInstructions.agentGender,
      // Simulator Gemini Live re-scores full instructions every turn — keep under ~6k chars
      // (~2–3k tokens) or time-to-first-audio balloons to 5–15s.
      telephony ? 5500 : 6000,
    );

    return voice.Agent.create({
      instructions: s2sInstructions,
      llm: createGeminiLiveModel({ s2sConfig, telephony }),
      tools,
      onUserTurnCompleted: handleUserTurn,
    });
  }

  const cartesiaKey = process.env.CARTESIA_API_KEY;
  if (!cartesiaKey) throw new Error('CARTESIA_API_KEY is required');

  const tts = createMultilingualCartesiaTts({
    apiKey: cartesiaKey,
    voiceId: agent.voiceId,
    voiceLanguages: agent.voiceLanguages,
    speed: agent.voiceSpeed,
    pitch: agent.voicePitch,
    model: agent.ttsModel,
    sampleRate: agent.ttsSampleRate ?? 24000,
    emotion: resolveSimulator2TtsEmotion(agent.ttsEmotion),
    agentGender,
  });

  const handleUserTurn = createUserTurnHandler({
    ...turnOpts,
    onLanguageLockChange: (locale) => tts.setCallLanguageLock(locale),
  });

  return voice.Agent.create({
    instructions,
    llm: createLlm(agent),
    tts,
    tools,
    onUserTurnCompleted: handleUserTurn,
  });
}
