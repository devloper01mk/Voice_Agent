import { beta, voice } from '@livekit/agents';
import type { Room } from '@livekit/rtc-node';
import {
  buildSimulator2Instructions,
  mergeSkillsConfig,
  productKnowledgeFromSources,
  type CallDirection,
} from '@vsa/shared';
import type { RuntimeAgent } from './load-agent.js';
import { createLlm } from './llm-factory.js';
import { createMultilingualCartesiaTts } from './multilingual-tts.js';
import { createTools } from './tools.js';
import { createUserTurnHandler, type BookingLockBox } from './user-turn-handler.js';

const END_CALL_EXTRA = `
Also call end_call when:
- Off-topic / irrelevant chat hit the redirect limit (after short product redirects).
- Timepass / casual banter hit the casual-turn limit.
- Caller is not interested and you have given the polite close.

Never call end_call when the caller asks who you are or why you called — restate purpose and continue.
Never call end_call when they choose a listed offering or ask what you want them to do — recommend from Product Knowledge and offer the next step.
Never announce a booking time or “noted” slot unless capture_demo_lead already returned ok:true.
**Hangup order:** (1) Speak a short warm goodbye as AUDIO only. (2) Then invoke end_call as a pure tool with empty args. NEVER put spoken words inside the tool call.
Do not keep chatting after the wrap limit.
`;

function toolsWithEndCall(
  agentId: string,
  callId: string | undefined,
  knownContact: Parameters<typeof createTools>[2],
  hooks?: Parameters<typeof createTools>[3],
) {
  const base = createTools(agentId, callId, knownContact, hooks);
  return [
    ...Object.entries(base).map(([name, toolDef]) => ({
      ...toolDef,
      id: name,
      name,
    })),
    beta.createEndCallTool({
      extraDescription: END_CALL_EXTRA,
      deleteRoom: true,
      endInstructions: null,
    }),
  ];
}

export function createVoiceAgent(
  agent: RuntimeAgent,
  callId?: string,
  direction: CallDirection = 'inbound',
  prospectName?: string,
  contactPhone?: string,
  contactEmail?: string,
  _room?: Room,
) {
  const cartesiaKey = process.env.CARTESIA_API_KEY;
  if (!cartesiaKey) throw new Error('CARTESIA_API_KEY is required');

  const skills = mergeSkillsConfig(agent.skillsConfig);
  const { instructions, knownContact } = buildSimulator2Instructions({
    agent,
    direction,
    prospectName,
    contactPhone,
    contactEmail,
    skills,
  });

  const bookingLock: BookingLockBox = { saved: false };
  const tools = toolsWithEndCall(agent.id, callId, knownContact, {
    onBookingSaved: (preferredTime) => {
      bookingLock.saved = true;
      bookingLock.preferredTime = preferredTime;
    },
  });

  const tts = createMultilingualCartesiaTts({
    apiKey: cartesiaKey,
    voiceId: agent.voiceId,
    voiceLanguages: agent.voiceLanguages,
    speed: agent.voiceSpeed,
    pitch: agent.voicePitch,
    model: agent.ttsModel,
    sampleRate: agent.ttsSampleRate ?? 24000,
    emotion: agent.ttsEmotion,
    agentGender: agent.agentGender,
  });

  const handleUserTurn = createUserTurnHandler({
    productName: agent.productName,
    skillsConfig: skills,
    agentId: agent.id,
    direction,
    productKnowledge: productKnowledgeFromSources(agent.brainSummary, agent.compiledSystemPrompt),
    bookingLock,
    hasConsumedLeadHistory: Boolean(agent.hasConsumedLeadHistory),
    agentGender: agent.agentGender,
    contactName: prospectName,
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
