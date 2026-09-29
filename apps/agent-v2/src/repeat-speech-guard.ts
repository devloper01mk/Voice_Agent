import { voice } from '@livekit/agents';

export type RepeatSpeechState = {
  /** Caller said something new that still needs one answer. */
  userPending: boolean;
  /** A real lookup result still needs one spoken answer. */
  toolPending: boolean;
  /** The agent already produced a spoken line since the last caller turn. */
  agentAlreadySpoke: boolean;
  /** We already started the reply to this caller turn, so an empty lookup must not start another. */
  openedCallerTurn: boolean;
};

export function freshRepeatSpeechState(): RepeatSpeechState {
  return { userPending: false, toolPending: false, agentAlreadySpoke: false, openedCallerTurn: false };
}

export function noteUserTranscript(state: RepeatSpeechState): void {
  state.userPending = true;
  state.agentAlreadySpoke = false;
  state.openedCallerTurn = false;
}

export function noteCallerText(
  state: RepeatSpeechState,
  text: string,
  seen: { last: string },
): boolean {
  const normalized = text.trim();
  if (!normalized || normalized.startsWith('[SYSTEM:')) return false;
  if (normalized === seen.last) return false;
  seen.last = normalized;
  noteUserTranscript(state);
  return true;
}

export function noteAssistantSpoke(state: RepeatSpeechState): void {
  state.agentAlreadySpoke = true;
}

/**
 * A lookup with no city, after the agent already asked, must not start another line.
 * A lookup that returns real inventory may speak once, even if the first generation
 * was only the tool call and had no audio.
 */
export function noteToolResult(state: RepeatSpeechState, opts: { missingPlace: boolean }): void {
  if (opts.missingPlace && (state.agentAlreadySpoke || state.openedCallerTurn)) return;
  state.toolPending = true;
}

export function decideRepeatSpeech(
  state: RepeatSpeechState,
  opts: { userInitiated: boolean },
): 'allow' | 'drop' {
  if (opts.userInitiated) return 'allow';
  if (state.userPending) {
    state.userPending = false;
    state.openedCallerTurn = true;
    return 'allow';
  }
  if (state.toolPending) {
    state.toolPending = false;
    return 'allow';
  }
  return 'drop';
}

export function toolOutputMissingPlace(output: string): boolean {
  return output.includes('city or state is required');
}

export function attachRepeatSpeechGuard(session: voice.AgentSession): void {
  const state = freshRepeatSpeechState();
  const seen = { last: '' };

  session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
    noteCallerText(state, ev.transcript ?? '', seen);
  });

  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
    const item = ev.item as { role?: string; textContent?: string | null };
    const text = (item.textContent ?? '').trim();
    if (item.role === 'assistant' && text) noteAssistantSpoke(state);
  });

  session.on(voice.AgentSessionEventTypes.FunctionToolsExecuted, (ev) => {
    const missingPlace = ev.functionCallOutputs.some((out) => toolOutputMissingPlace(out.output ?? ''));
    const hasRealTool = ev.functionCallOutputs.length > 0;
    if (!hasRealTool) return;
    noteToolResult(state, { missingPlace });
  });

  session.on(voice.AgentSessionEventTypes.SpeechCreated, (ev) => {
    if (ev.userInitiated) return;
    const handle = ev.speechHandle;
    // The caller transcript often arrives in the same instant, just after this event.
    // Deciding immediately drops the real reply (seen on "haan ji, bataiye").
    setTimeout(() => {
      const decision = decideRepeatSpeech(state, { userInitiated: false });
      if (decision === 'allow') return;
      console.warn('REPEAT_SPEECH_DROPPED', 'no new caller words and no new lookup to speak');
      handle.interrupt(true);
    }, 200).unref?.();
  });
}
