import { voice } from '@livekit/agents';
import {
  DEFAULT_CORE_SKILLS,
  DEFAULT_RUNTIME,
  mergeSkillsConfig,
  type SkillsConfig,
} from '@vsa/shared';

function messageText(content: Array<string | { value?: string }>): string {
  return content
    .map((c) => (typeof c === 'string' ? c : (c.value ?? '')))
    .join('')
    .trim();
}

/**
 * Code-enforced silence-on-line timers (Studio-configurable).
 * Starts waiting only after the agent speaks (waiting for a user reply).
 * Does NOT fire on call connect — only after ~silenceFirstPromptSec with no reply.
 */
export function attachSilenceWatchdog(
  session: voice.AgentSession,
  skillsConfig?: Partial<SkillsConfig> | null,
): void {
  const skills = mergeSkillsConfig(skillsConfig);
  const runtime = skills.runtime ?? DEFAULT_RUNTIME;
  const core = skills.core ?? DEFAULT_CORE_SKILLS;

  const firstMs = Math.max(30, runtime.silenceFirstPromptSec) * 1000;
  const endMs = Math.max(runtime.silenceFirstPromptSec + 30, runtime.silenceEndSec) * 1000;

  let waitStartedAt = 0;
  let checkinDone = false;
  let ended = false;
  let firstTimer: ReturnType<typeof setTimeout> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    if (firstTimer) clearTimeout(firstTimer);
    if (endTimer) clearTimeout(endTimer);
    firstTimer = undefined;
    endTimer = undefined;
  };

  /** Start / restart the “waiting for user reply” clock. */
  const scheduleWaitForReply = () => {
    clearTimers();
    if (ended) return;

    waitStartedAt = Date.now();
    const startedAt = waitStartedAt;

    firstTimer = setTimeout(async () => {
      if (ended || startedAt !== waitStartedAt || checkinDone) return;
      checkinDone = true;
      try {
        await session.say(core.silence.checkInLine, { allowInterruptions: true }).waitForPlayout();
      } catch {
        /* session closing */
      }
    }, firstMs);

    endTimer = setTimeout(async () => {
      if (ended || startedAt !== waitStartedAt) return;
      ended = true;
      clearTimers();
      try {
        await session.say(core.silence.goodbyeLine, { allowInterruptions: false }).waitForPlayout();
      } catch {
        /* session closing */
      }
      try {
        session.shutdown({ drain: true, reason: 'user_initiated' });
      } catch {
        /* ignore */
      }
    }, endMs);
  };

  const cancelWait = () => {
    waitStartedAt = 0;
    checkinDone = false;
    clearTimers();
  };

  // User replied — stop silence clock until agent speaks again.
  session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
    if (!ev.isFinal || !ev.transcript?.trim()) return;
    cancelWait();
  });

  // Agent finished a turn — now wait for the caller's reply.
  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
    if (ev.item.type !== 'message') return;
    const msg = ev.item;
    if (msg.role !== 'assistant') return;
    const text = messageText(msg.content as Array<string | { value?: string }>);
    if (!text) return;
    // Don't restart wait for the silence check-in / goodbye lines themselves.
    if (text === core.silence.checkInLine || text === core.silence.goodbyeLine) return;
    checkinDone = false;
    scheduleWaitForReply();
  });

  session.on(voice.AgentSessionEventTypes.Close, () => {
    ended = true;
    clearTimers();
  });
}
