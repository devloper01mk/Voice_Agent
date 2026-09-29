import { voice } from '@livekit/agents';
import {
  DEFAULT_CORE_SKILLS,
  looksLikeHumanReply,
  looksLikeVoicemailPrompt,
  mergeSkillsConfig,
  SILENCE_CHECK_MS,
  silenceStep,
  type SkillsConfig,
} from '@vsa/shared';
import { speakLine } from './speak-line.js';

function messageText(content: Array<string | { value?: string }>): string {
  return content
    .map((c) => (typeof c === 'string' ? c : (c.value ?? '')))
    .join('')
    .trim();
}

/**
 * After the agent finishes a real turn, wait 15s. No human reply → check-in.
 * Repeat twice more (45s total). The third check is followed immediately by the
 * formal goodbye and hangup. A voicemail greeting ends the call at once.
 * Beeps and mailbox scripts do not reset the clock.
 */
export function attachSilenceWatchdog(
  session: voice.AgentSession,
  skillsConfig?: Partial<SkillsConfig> | null,
  names?: { agentName?: string; productName?: string },
): void {
  const skills = mergeSkillsConfig(skillsConfig);
  const core = skills.core ?? DEFAULT_CORE_SKILLS;
  const checkLine = core.silence.checkInLine;
  const byeLine = core.silence.goodbyeLine;
  const vmLine = core.voicemail.messageScript
    .replaceAll('{agent_name}', names?.agentName?.trim() || 'main')
    .replaceAll('{product_name}', names?.productName?.trim() || 'yahan se');

  let checks = 0;
  let ended = false;
  let callerSpeaking = false;
  /** A real caller line arrived after the agent's last turn. */
  let heardReply = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let voicemailHandled = false;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const noteCaller = (text: string) => {
    if (looksLikeVoicemailPrompt(text)) {
      if (voicemailHandled) return;
      voicemailHandled = true;
      void hangup(vmLine);
      return;
    }
    if (!looksLikeHumanReply(text)) return;
    checks = 0;
    heardReply = true;
    clearTimer();
  };

  const hangup = async (line: string) => {
    if (ended) return;
    ended = true;
    clearTimer();
    await speakLine(session, line, { allowInterruptions: false });
    try {
      session.shutdown({ drain: true, reason: 'user_initiated' });
    } catch {
      /* ignore */
    }
  };

  const arm = () => {
    clearTimer();
    if (ended) return;
    timer = setTimeout(async () => {
      if (ended || heardReply) return;
      if (callerSpeaking) {
        arm();
        return;
      }
      const step = silenceStep(checks);
      checks += 1;
      await speakLine(session, checkLine, { allowInterruptions: true });
      if (ended || heardReply) return;
      if (step === 'check_then_end') {
        await hangup(byeLine);
        return;
      }
      arm();
    }, SILENCE_CHECK_MS);
  };

  const isOwnLine = (text: string) =>
    text === checkLine ||
    text === byeLine ||
    text === vmLine ||
    /awaz aa rehi|awaaz aa rahi|disconnect kar|callback kar lijiye/i.test(text);

  session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
    if (!ev.isFinal || !ev.transcript?.trim() || ended) return;
    noteCaller(ev.transcript.trim());
  });

  session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
    if (ended) return;
    if (ev.newState === 'speaking') {
      callerSpeaking = true;
      clearTimer();
      return;
    }
    if (callerSpeaking && ev.newState === 'listening') {
      callerSpeaking = false;
      if (!heardReply) arm();
    }
  });

  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
    if (ended || ev.item.type !== 'message') return;
    const msg = ev.item;
    const text = messageText(msg.content as Array<string | { value?: string }>);
    if (!text) return;
    if (msg.role === 'user') {
      noteCaller(text);
      return;
    }
    if (msg.role !== 'assistant' || isOwnLine(text)) return;
    checks = 0;
    heardReply = false;
    arm();
  });

  session.on(voice.AgentSessionEventTypes.Close, () => {
    ended = true;
    clearTimer();
  });
}
