/**
 * Runtime fixes for @livekit/agents-plugin-google RealtimeSession (verified on 1.5.0; same
 * logic in 1.9.0). Applied by wrapping RealtimeModel.prototype.session, since RealtimeSession
 * itself is not exported.
 *
 * 1. A bare generationComplete / turnComplete (no audio, no transcript) must not start a new
 *    generation — the plugin emits a fake input_speech_started for it, LiveKit treats that as a
 *    caller barge-in, aborts the speech that owns the pending tool call, and the tool response
 *    is never sent. Gemini then waits forever and ignores the caller.
 * 2. Stuck-call guard: any tool call still pending after its result exists (or after a hard
 *    ceiling) gets a tool_response sent directly, so the session always recovers.
 * 3. TURN_METRIC / TOOL_METRIC log lines for latency and dropped-tool diagnosis.
 * 4. If Gemini still has not spoken ~3.5s after a tool_response, send one content nudge.
 */

import * as google from '@livekit/agents-plugin-google';
import { forgetToolResult, markToolResultRecovered, peekToolResult } from './tool-result-cache.js';

/** After a tool_response, if Gemini still has not spoken, nudge it once. */
export const TOOL_SPEECH_NUDGE_MS = 3_500;
const TOOL_SPEECH_NUDGE =
  '[SYSTEM: Tool result is ready. If you already spoke since this result, stay silent — do not repeat rooms, the property name, or a question you just asked. Otherwise one new sentence only.]';
/** A nudge right after the model already talked creates a second copy of the same line. */
const NUDGE_SUPPRESS_AFTER_AUDIO_MS = 8_000;

/** Result exists but LiveKit has not sent it after this long → send it ourselves. */
export const STUCK_TOOL_RESULT_GRACE_MS = 2_000;
/** No result at all after this long (tool hung / crashed) → send a timeout response. */
export const STUCK_TOOL_MAX_MS = 20_000;
const GUARD_TICK_MS = 1_000;

const PATCHED = Symbol.for('vsa.geminiRealtimePatched');
const STATE = Symbol.for('vsa.geminiRealtimeState');

type GeminiResponse = {
  toolCall?: { functionCalls?: Array<{ id?: string; name?: string }> };
  voiceActivity?: { type?: string };
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: unknown }> };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    generationComplete?: boolean;
    turnComplete?: boolean;
    interrupted?: boolean;
  };
};

type ToolStatus = { name: string; status: string; createdAt: number };

type SessionState = {
  guardTimer?: ReturnType<typeof setInterval>;
  speechNudgeTimer?: ReturnType<typeof setTimeout>;
  speechNudged: boolean;
  recovered: Set<string>;
  userEndAt?: number;
  awaitingFirstAudio: boolean;
  lastAudioAt?: number;
  toolStartedAt: Map<string, number>;
};

export type PatchableSession = {
  isNewGeneration(response: GeminiResponse): boolean;
  onReceiveMessage(session: unknown, response: GeminiResponse): Promise<void>;
  handleToolCall(toolCall: NonNullable<GeminiResponse['toolCall']>): void;
  sendClientEvent(event: { type: string; value: unknown }): void;
  close(): Promise<void>;
  pendingToolCallIds: Set<string>;
  toolCallStatuses: Map<string, ToolStatus>;
  [STATE]?: SessionState;
};

/** True when a server message only closes a turn — it carries no new model output. */
export function isBareCompletion(response: GeminiResponse): boolean {
  if (response.toolCall) return false;
  const sc = response.serverContent;
  if (!sc) return false;
  const hasOutput =
    Boolean(sc.modelTurn) || sc.inputTranscription != null || sc.outputTranscription != null;
  return !hasOutput && (sc.generationComplete != null || sc.turnComplete != null);
}

/** Pending call ids that need a direct tool_response now. */
export function findStuckToolCalls(opts: {
  pending: Iterable<string>;
  statuses: Map<string, ToolStatus>;
  recovered: Set<string>;
  now: number;
  resultAt: (callId: string) => number | undefined;
}): string[] {
  const stuck: string[] = [];
  for (const id of opts.pending) {
    if (opts.recovered.has(id)) continue;
    const createdAt = opts.statuses.get(id)?.createdAt ?? opts.now;
    const at = opts.resultAt(id);
    if (at != null ? opts.now - at >= STUCK_TOOL_RESULT_GRACE_MS : opts.now - createdAt >= STUCK_TOOL_MAX_MS) {
      stuck.push(id);
    }
  }
  return stuck;
}

const TIMEOUT_OUTPUT = JSON.stringify({
  ok: false,
  error: 'tool_timeout',
  rule: 'The check did not complete. Say sorry in one short line and continue helping; ask them to repeat if needed. Never go silent.',
});

function state(s: PatchableSession): SessionState {
  let st = s[STATE];
  if (!st) {
    st = {
      recovered: new Set(),
      speechNudged: false,
      awaitingFirstAudio: false,
      toolStartedAt: new Map(),
    };
    s[STATE] = st;
  }
  return st;
}

function stopGuard(s: PatchableSession) {
  const st = s[STATE];
  if (st?.guardTimer) {
    clearInterval(st.guardTimer);
    st.guardTimer = undefined;
  }
}

function clearSpeechNudge(st: SessionState) {
  if (st.speechNudgeTimer) {
    clearTimeout(st.speechNudgeTimer);
    st.speechNudgeTimer = undefined;
  }
  st.speechNudged = false;
}

export function armToolSpeechNudge(
  s: PatchableSession,
  now = Date.now(),
  delayMs = TOOL_SPEECH_NUDGE_MS,
): void {
  const st = state(s);
  if (st.lastAudioAt != null && now - st.lastAudioAt < NUDGE_SUPPRESS_AFTER_AUDIO_MS) {
    st.awaitingFirstAudio = false;
    return;
  }
  st.awaitingFirstAudio = true;
  st.userEndAt = now;
  if (st.speechNudged) return;
  if (st.speechNudgeTimer) clearTimeout(st.speechNudgeTimer);
  st.speechNudgeTimer = setTimeout(() => {
    if (!st.awaitingFirstAudio || st.speechNudged) return;
    st.speechNudged = true;
    st.speechNudgeTimer = undefined;
    console.warn('DEAD_AIR_NUDGE', JSON.stringify({ reason: 'no_audio_after_tool_response' }));
    s.sendClientEvent({
      type: 'content',
      value: {
        turns: [{ role: 'user', parts: [{ text: TOOL_SPEECH_NUDGE }] }],
        turnComplete: true,
      },
    });
  }, delayMs);
  st.speechNudgeTimer.unref?.();
}

export function runStuckToolGuard(s: PatchableSession, now = Date.now()): string[] {
  const st = state(s);
  const stuck = findStuckToolCalls({
    pending: s.pendingToolCallIds,
    statuses: s.toolCallStatuses,
    recovered: st.recovered,
    now,
    resultAt: (id) => peekToolResult(id)?.at,
  });
  for (const id of stuck) {
    const cached = peekToolResult(id);
    const name = s.toolCallStatuses.get(id)?.name ?? 'unknown_tool';
    st.recovered.add(id);
    console.warn(
      'TOOL_RESPONSE_RECOVERED',
      JSON.stringify({ callId: id, name, withResult: Boolean(cached), ageMs: now - (s.toolCallStatuses.get(id)?.createdAt ?? now) }),
    );
    s.sendClientEvent({
      type: 'tool_response',
      value: { functionResponses: [{ id, name, response: { output: cached?.output ?? TIMEOUT_OUTPUT } }] },
    });
    forgetToolResult(id);
    markToolResultRecovered(id);
  }
  if (s.pendingToolCallIds.size === 0 || [...s.pendingToolCallIds].every((id) => st.recovered.has(id))) {
    stopGuard(s);
  }
  return stuck;
}

export function patchRealtimeSessionPrototype(proto: PatchableSession): boolean {
  const target = proto as PatchableSession & { [PATCHED]?: boolean };
  if (target[PATCHED]) return false;
  const required = ['isNewGeneration', 'onReceiveMessage', 'handleToolCall', 'sendClientEvent', 'close'] as const;
  if (!required.every((m) => typeof target[m] === 'function')) {
    console.warn('[vsa] Gemini realtime patch skipped — plugin internals changed');
    return false;
  }

  const origIsNew = target.isNewGeneration;
  target.isNewGeneration = function (this: PatchableSession, response: GeminiResponse) {
    if (isBareCompletion(response)) return false;
    return origIsNew.call(this, response);
  };

  const origReceive = target.onReceiveMessage;
  target.onReceiveMessage = async function (this: PatchableSession, session: unknown, response: GeminiResponse) {
    const st = state(this);
    const now = Date.now();
    if (response.voiceActivity?.type === 'ACTIVITY_END') {
      st.userEndAt = now;
      st.awaitingFirstAudio = true;
    } else if (response.voiceActivity?.type === 'ACTIVITY_START') {
      st.awaitingFirstAudio = false;
    }
    const hasAudio = response.serverContent?.modelTurn?.parts?.some((p) => p.inlineData) ?? false;
    if (hasAudio) st.lastAudioAt = now;
    if (st.awaitingFirstAudio && st.userEndAt != null && (hasAudio || response.toolCall)) {
      console.info(
        'TURN_METRIC',
        JSON.stringify({ userEndToFirstMs: now - st.userEndAt, first: hasAudio ? 'audio' : 'tool_call' }),
      );
      st.awaitingFirstAudio = false;
      clearSpeechNudge(st);
    }
    return origReceive.call(this, session, response);
  };

  const origToolCall = target.handleToolCall;
  target.handleToolCall = function (this: PatchableSession, toolCall) {
    origToolCall.call(this, toolCall);
    const st = state(this);
    for (const fc of toolCall.functionCalls ?? []) {
      if (fc.id) st.toolStartedAt.set(fc.id, Date.now());
    }
    if (!st.guardTimer && this.pendingToolCallIds.size > 0) {
      st.guardTimer = setInterval(() => runStuckToolGuard(this), GUARD_TICK_MS);
      st.guardTimer.unref?.();
    }
  };

  const origSend = target.sendClientEvent;
  target.sendClientEvent = function (this: PatchableSession, event) {
    if (event?.type === 'tool_response') {
      const st = state(this);
      const responses = (event.value as { functionResponses?: Array<{ id?: string; name?: string }> })?.functionResponses ?? [];
      for (const r of responses) {
        if (!r.id) continue;
        const started = st.toolStartedAt.get(r.id);
        console.info(
          'TOOL_METRIC',
          JSON.stringify({ callId: r.id, name: r.name, callToResponseMs: started != null ? Date.now() - started : undefined, recovered: st.recovered.has(r.id) }),
        );
        st.toolStartedAt.delete(r.id);
        forgetToolResult(r.id);
      }
      armToolSpeechNudge(this);
    }
    return origSend.call(this, event);
  };

  const origClose = target.close;
  target.close = async function (this: PatchableSession) {
    stopGuard(this);
    const st = this[STATE];
    if (st) clearSpeechNudge(st);
    return origClose.call(this);
  };

  target[PATCHED] = true;
  return true;
}

let modelPatched = false;

/** Patch every RealtimeSession created by the Google plugin (idempotent). */
export function applyGeminiRealtimePatches(): void {
  if (modelPatched) return;
  const modelProto = google.realtime.RealtimeModel.prototype as unknown as {
    session: (...args: unknown[]) => object;
  };
  const origSession = modelProto.session;
  if (typeof origSession !== 'function') {
    console.warn('[vsa] Gemini realtime patch skipped — RealtimeModel.session missing');
    return;
  }
  modelProto.session = function (this: unknown, ...args: unknown[]) {
    const s = origSession.apply(this, args);
    if (patchRealtimeSessionPrototype(Object.getPrototypeOf(s) as PatchableSession)) {
      console.info('[vsa] Gemini realtime session patched (bare-completion fix, stuck-tool guard, metrics)');
    }
    return s;
  };
  modelPatched = true;
}
