import { voice } from '@livekit/agents';
import type { Room } from '@livekit/rtc-node';
import { stripSystemNotesForDisplay, stripAgentToolNoiseForDisplay } from '@vsa/shared';

interface TranscriptLine {
  id: string;
  role: 'user' | 'agent';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

function messageText(content: Array<string | { value?: string }>): string {
  return content
    .map((c) => (typeof c === 'string' ? c : (c.value ?? '')))
    .join('')
    .trim();
}

export function attachCallTranscriptPersist(
  session: voice.AgentSession,
  room: Room,
  callId?: string,
) {
  if (!callId) return;

  const lines = new Map<string, TranscriptLine>();

  const upsert = (line: TranscriptLine) => {
    lines.set(line.id, line);
  };

  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
    if (ev.item.type !== 'message') return;
    const msg = ev.item;
    const raw = messageText(msg.content as Array<string | { value?: string }>);
    const role = msg.role === 'user' ? 'user' : 'agent';
    const text =
      role === 'user'
        ? stripSystemNotesForDisplay(raw)
        : stripAgentToolNoiseForDisplay(raw);
    if (!text) return;
    upsert({
      id: msg.id,
      role,
      text,
      isFinal: true,
      timestamp: msg.createdAt,
    });
  });

  session.on(voice.AgentSessionEventTypes.Close, () => {
    void persistTranscript(callId, lines);
  });
}

async function persistTranscript(callId: string, lines: Map<string, TranscriptLine>) {
  const sorted = [...lines.values()].sort((a, b) => a.timestamp - b.timestamp);
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
  try {
    // Always mark completed so API fires Nexora call.completed webhook (even empty calls).
    await fetch(`${apiUrl}/api/calls/${callId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: { lines: sorted },
        outcome: 'completed',
        status: 'completed',
      }),
    });
  } catch {
    /* best-effort */
  }
}
