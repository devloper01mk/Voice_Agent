import { getJobContext, llm, type voice } from '@livekit/agents';
import { callerAskedToEndCall } from '@vsa/shared';
import { z } from 'zod';

const REFUSAL =
  'Do not hang up. Their last words are not thank you, bye, or bas. Answer that line and stay on the call. Do not guess that they are finished.';

function lastUserText(session: voice.AgentSession | undefined): string {
  const items = session?.history?.items ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as { type?: string; role?: string; textContent?: string };
    if (item.type === 'message' && item.role === 'user' && item.textContent?.trim()) {
      return item.textContent.trim();
    }
  }
  return '';
}

/** end_call that disconnects only when the caller said a written goodbye. */
export function createGuardedEndCallTool(extraDescription: string) {
  return llm.tool({
    description:
      'Disconnect the phone. Call this only when the caller\'s latest words are thank you, bye, or bas, or they said wrong number / do not call again. ' +
      'Do not call it because a booking was saved, a payment question was answered, or you think the call feels finished. ' +
      extraDescription,
    parameters: z.object({}),
    execute: async (_args, opts) => {
      const session = opts?.ctx?.session as voice.AgentSession | undefined;
      const said = lastUserText(session);
      if (!callerAskedToEndCall(said)) {
        console.warn('END_CALL_BLOCKED', JSON.stringify({ lastUser: said.slice(0, 180) }));
        return { ok: false, say: REFUSAL };
      }
      console.info('END_CALL_ALLOWED', JSON.stringify({ lastUser: said.slice(0, 180) }));
      const speech = opts?.ctx?.speechHandle as { addDoneCallback?: (cb: () => void) => void } | undefined;
      speech?.addDoneCallback?.(() => {
        try {
          session?.shutdown();
        } catch {
          /* session may already be closing */
        }
        const job = getJobContext(false);
        job?.shutdown('end_call');
      });
      return { ok: true };
    },
  });
}
