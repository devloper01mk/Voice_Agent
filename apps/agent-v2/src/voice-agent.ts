import { voice } from '@livekit/agents';
import type { Room } from '@livekit/rtc-node';
import {
  buildGeminiLiveS2sInstructionSupplement,
  buildSimulator2Instructions,
  appendHinglishGenderLock,
  isFemaleGeminiLiveVoice,
  mergeSkillsConfig,
  normalizeRealtimeS2sUserConfig,
  resolveSimulator2TtsEmotion,
  SIMULATOR2_DEFAULT_TTS_EMOTION,
  type CallDirection,
  productKnowledgeFromSources,
  resolvePackForBooking,
} from '@vsa/shared';
import type { RuntimeAgent } from './load-agent.js';
import { createGeminiLiveModel } from './gemini-live-factory.js';
import { createTools } from './tools.js';
import { createGuardedEndCallTool } from './end-call-tool.js';
import { withCachedResult } from './tool-result-cache.js';
import { createUserTurnHandler, type BookingLockBox } from './user-turn-handler.js';

export { resolveSimulator2TtsEmotion, SIMULATOR2_DEFAULT_TTS_EMOTION };

function buildEndCallExtra(packRules: string[]): string {
  return `
Call end_call only when the caller's latest words are one of these, with no guessing:
- thank you, bye, or bas (bas only when that is the whole reply, or "bas ho gaya")
- wrong number
- do not call again

A question is not a goodbye. Payment, price, date, room, name, cancellation, or "what if I don't pay" means stay and answer.
Never call end_call because a booking was saved or the answer felt complete.
${packRules.map((r) => `${r}\n`).join('')}Speak a short goodbye in audio first, then call end_call with empty args. If the tool returns do-not-hang-up, stay on the line.
`;
}

function toolsWithEndCall(
  agentId: string,
  callId: string | undefined,
  knownContact: Parameters<typeof createTools>[2],
  hooks?: Parameters<typeof createTools>[3],
  bookingPolicy?: Parameters<typeof createTools>[4],
  agentGender?: string,
) {
  const base = createTools(agentId, callId, knownContact, hooks, bookingPolicy, agentGender);
  const pack = resolvePackForBooking(bookingPolicy);
  return [
    ...Object.entries(base).map(([name, toolDef]) => ({
      ...withCachedResult(toolDef),
      id: name,
      name,
    })),
    { ...withCachedResult(createGuardedEndCallTool(buildEndCallExtra(pack.endCallRules))), id: 'end_call', name: 'end_call' },
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
  const agentGender = isFemaleGeminiLiveVoice(s2sVoice)
    ? 'female'
    : agent.agentGender === 'male'
      ? 'male'
      : 'female';
  const { skills, knownContact } = buildInstructions(
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
    `${s2sBaseInstructions}${buildGeminiLiveS2sInstructionSupplement(
      s2sConfig.voice,
      s2sConfig.model,
      resolvePackForBooking(skills.booking).s2sRules,
    )}`,
    agentForInstructions.agentGender,
    // Simulator Gemini Live re-scores full instructions every turn — keep under ~6k chars
    // (~2–3k tokens) or time-to-first-audio balloons to 5–15s.
    telephony ? 5500 : 6000,
  );

  return {
    agent: voice.Agent.create({
      instructions: s2sInstructions,
      llm: createGeminiLiveModel({ s2sConfig, telephony }),
      tools,
      onUserTurnCompleted: handleUserTurn,
    }),
    bookingLock,
    agentGender,
  };
}
