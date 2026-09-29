import type { ChatContext, ChatMessage } from '@livekit/agents';
import { voice } from '@livekit/agents';
import {
  emptySimulator2TurnState,
  getKnownEmailDomains,
  mergeSkillsConfig,
  prepareSimulator2UserTurn,
  rememberSimulator2Assistant,
  stripSystemNotesForDisplay,
  lockSpokenHinglishGender,
  type Simulator2TurnState,
  type SkillsConfig,
  type CallDirection,
} from '@vsa/shared';
import { speakLine } from './speak-line.js';
import { apiFetch } from './api-fetch.js';

export type BookingLockBox = { saved: boolean; preferredTime?: string };

export interface UserTurnHandlerOptions {
  productName: string;
  skillsConfig?: Partial<SkillsConfig> | null;
  agentId?: string;
  /** Sync TTS locale when effective call speech language changes. */
  onLanguageLockChange?: (locale: 'en' | 'hi' | null) => void;
  direction?: CallDirection;
  productKnowledge?: string;
  bookingLock?: BookingLockBox;
  /** Consumed/past bookings in retention window — enables prior-recall SYSTEM note. */
  hasConsumedLeadHistory?: boolean;
  agentGender?: string;
  contactName?: string;
  callId?: string;
}

/**
 * LiveKit Agent.create passes (ctx, chatCtx, newMessage).
 * Shared turn policy: mute/hold/facts/tools — not an intent classifier.
 */
export function createUserTurnHandler(options: UserTurnHandlerOptions) {
  const skills = mergeSkillsConfig(options.skillsConfig);
  const knownEmailDomains = getKnownEmailDomains(skills);
  let state: Simulator2TurnState = emptySimulator2TurnState();

  return async function handleUserTurnCompleted(
    ctx: voice.AgentContext,
    chatCtx: ChatContext,
    newMessage: ChatMessage,
  ): Promise<void> {
    const heard = newMessage.textContent?.trim();
    if (!heard) return;

    sanitizePriorUserNotes(chatCtx);

    const recentAgentTurns: string[] = [];
    try {
      for (const item of chatCtx.items ?? []) {
        if (item.type !== 'message') continue;
        const msg = item as { role?: string; textContent?: string };
        if (msg.role !== 'assistant') continue;
        const t = msg.textContent?.trim();
        if (t) recentAgentTurns.push(t);
      }
    } catch {
      /* ignore */
    }
    const lastAssistantTurn = recentAgentTurns[recentAgentTurns.length - 1] ?? '';
    if (lastAssistantTurn) {
      state = rememberSimulator2Assistant(state, lastAssistantTurn);
    }

    const sttLocale = sttLocaleFromMessage(newMessage);
    const beforeLedger = state.negotiation?.ledger.length ?? 0;
    const result = await prepareSimulator2UserTurn({
      heard,
      confidence: newMessage.transcriptConfidence,
      sttLocale,
      lastAssistantText: lastAssistantTurn,
      recentAssistantTexts: recentAgentTurns,
      productName: options.productName,
      skills,
      knownEmailDomains,
      state,
      direction: options.direction,
      productKnowledge: options.productKnowledge,
      bookingLock: options.bookingLock,
      hasConsumedLeadHistory: options.hasConsumedLeadHistory,
      agentGender: options.agentGender,
      contactName: options.contactName,
      callId: options.callId,
    });
    state = result.state;
    const latest = state.negotiation?.ledger.at(-1);
    if (options.callId && latest && (state.negotiation?.ledger.length ?? 0) > beforeLedger) {
      void apiFetch(`/api/calls/${options.callId}/negotiation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: options.agentId ?? '', event: latest }),
      }).catch((err: unknown) => {
        console.info(`[NEGOTIATION_ERROR] call_id=${options.callId} reason=${err instanceof Error ? err.message : 'persist failed'}`);
      });
    }
    if (result.ttsLocale !== undefined) {
      options.onLanguageLockChange?.(result.ttsLocale);
    }

    if (result.kind === 'mute') {
      throw new voice.StopResponse();
    }
    if (result.kind === 'say') {
      if (result.then === 'hangup') {
        await forcePoliteEnd(ctx, lockSpokenHinglishGender(result.text, options.agentGender));
        throw new voice.StopResponse();
      }
      await sayAndStop(ctx, lockSpokenHinglishGender(result.text, options.agentGender));
      return;
    }
    newMessage.content = [result.userContent];
  };
}

function sanitizePriorUserNotes(chatCtx: ChatContext) {
  const items = chatCtx.items ?? [];
  let lastUser = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as { type?: string; role?: string };
    if (item.type === 'message' && item.role === 'user') {
      lastUser = i;
      break;
    }
  }
  for (let i = 0; i < items.length; i++) {
    if (i === lastUser) continue;
    const item = items[i] as ChatMessage & { type?: string };
    if (item.type !== 'message' || item.role !== 'user') continue;
    const text = item.textContent;
    if (!text) continue;
    const stripped = stripSystemNotesForDisplay(text);
    if (stripped !== text) item.content = [stripped];
  }
}

function sttLocaleFromMessage(message: ChatMessage): string | null {
  const direct = (message as { language?: unknown }).language;
  if (typeof direct === 'string' && direct.trim()) return direct;
  const extra = message.extra?.language;
  if (typeof extra === 'string' && extra.trim()) return extra;
  return null;
}

async function sayAndStop(ctx: voice.AgentContext, line: string): Promise<never> {
  await speakLine(ctx.session, line, { allowInterruptions: true });
  throw new voice.StopResponse();
}

async function forcePoliteEnd(ctx: voice.AgentContext, exitLine: string) {
  await speakLine(ctx.session, exitLine, { allowInterruptions: false });
  try {
    ctx.session.shutdown({ drain: true, reason: 'user_initiated' });
  } catch {
    /* ignore */
  }
}
