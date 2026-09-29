import { voice } from '@livekit/agents';
import { lockSpokenHinglishGender } from '@vsa/shared';
import { onToolCacheEvent } from './tool-result-cache.js';
import { speakLine } from './speak-line.js';

/** Caller finished speaking — Gemini must start audio within this window. */
export const NO_RESPONSE_AFTER_USER_MS = 5_000;
/** Tool result is in — Gemini must start audio within this window. */
export const NO_RESPONSE_AFTER_TOOL_MS = 4_000;
/** Do not stack recovery lines. */
export const RECOVERY_COOLDOWN_MS = 8_000;

export const DEAD_AIR_RECOVERY_LINE = 'Sorry, line cut si ho gayi — aap kya keh rahe the?';

export type AgentActivityState = 'initializing' | 'idle' | 'listening' | 'thinking' | 'speaking';

export type DeadAirDecision =
  | { action: 'wait' }
  | { action: 'recover'; reason: 'user_silence' | 'tool_silence' };

/**
 * Should we speak a recovery line? Never interrupt thinking/speaking,
 * and never fire twice inside the cooldown.
 */
export function decideDeadAirRecovery(opts: {
  waitingSince: number | null;
  timeoutMs: number;
  reason: 'user_silence' | 'tool_silence';
  now: number;
  lastRecoveryAt: number;
  cooldownMs: number;
  agentState: AgentActivityState;
}): DeadAirDecision {
  if (opts.waitingSince == null) return { action: 'wait' };
  if (opts.agentState === 'speaking' || opts.agentState === 'thinking') return { action: 'wait' };
  if (opts.now - opts.lastRecoveryAt < opts.cooldownMs) return { action: 'wait' };
  if (opts.now - opts.waitingSince < opts.timeoutMs) return { action: 'wait' };
  return { action: 'recover', reason: opts.reason };
}

export function attachResponseWatchdog(
  session: voice.AgentSession,
  opts?: { agentGender?: string },
): void {
  let waitingSince: number | null = null;
  let timeoutMs = NO_RESPONSE_AFTER_USER_MS;
  let reason: 'user_silence' | 'tool_silence' = 'user_silence';
  let lastRecoveryAt = 0;
  let agentState: AgentActivityState = 'initializing';
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let recovering = false;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const cancelWait = () => {
    waitingSince = null;
    clearTimer();
  };

  const armWait = (ms: number, nextReason: 'user_silence' | 'tool_silence') => {
    if (ended) return;
    waitingSince = Date.now();
    timeoutMs = ms;
    reason = nextReason;
    clearTimer();
    timer = setTimeout(() => {
      void maybeRecover();
    }, ms);
  };

  const maybeRecover = async () => {
    if (ended || recovering) return;
    const decision = decideDeadAirRecovery({
      waitingSince,
      timeoutMs,
      reason,
      now: Date.now(),
      lastRecoveryAt,
      cooldownMs: RECOVERY_COOLDOWN_MS,
      agentState,
    });
    if (decision.action !== 'recover') return;
    recovering = true;
    lastRecoveryAt = Date.now();
    cancelWait();
    console.warn('DEAD_AIR_RECOVERY', JSON.stringify({ reason: decision.reason, agentState }));
    try {
      await speakLine(
        session,
        lockSpokenHinglishGender(DEAD_AIR_RECOVERY_LINE, opts?.agentGender),
        { allowInterruptions: true },
      );
    } finally {
      recovering = false;
    }
  };

  session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
    if (ev.newState === 'listening' && ev.oldState === 'speaking') {
      armWait(NO_RESPONSE_AFTER_USER_MS, 'user_silence');
    }
  });

  session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
    if (!ev.isFinal || !ev.transcript?.trim()) return;
    if (agentState === 'speaking') return;
    armWait(NO_RESPONSE_AFTER_USER_MS, 'user_silence');
  });

  session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
    agentState = ev.newState;
    if (ev.newState === 'speaking') {
      cancelWait();
    } else if (ev.newState === 'thinking' && waitingSince != null) {
      // Tool / model is working — give it the tool window, do not recover mid-think.
      armWait(NO_RESPONSE_AFTER_TOOL_MS, 'tool_silence');
    }
  });

  session.on(voice.AgentSessionEventTypes.FunctionToolsExecuted, () => {
    armWait(NO_RESPONSE_AFTER_TOOL_MS, 'tool_silence');
  });

  session.on(voice.AgentSessionEventTypes.SpeechCreated, () => {
    cancelWait();
  });

  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
    if (ev.item.type !== 'message') return;
    if ((ev.item as { role?: string }).role !== 'assistant') return;
    cancelWait();
  });

  const offTool = onToolCacheEvent((event) => {
    if (event.type === 'recovered') {
      armWait(NO_RESPONSE_AFTER_TOOL_MS, 'tool_silence');
    }
  });

  session.on(voice.AgentSessionEventTypes.Close, () => {
    ended = true;
    cancelWait();
    offTool();
  });
}
