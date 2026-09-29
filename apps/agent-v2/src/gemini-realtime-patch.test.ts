import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { initializeLogger } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import {
  applyGeminiRealtimePatches,
  armToolSpeechNudge,
  findStuckToolCalls,
  isBareCompletion,
  runStuckToolGuard,
  STUCK_TOOL_MAX_MS,
  STUCK_TOOL_RESULT_GRACE_MS,
  type PatchableSession,
} from './gemini-realtime-patch.js';
import { peekToolResult, rememberToolResult, withCachedResult } from './tool-result-cache.js';

initializeLogger({ pretty: false, level: 'fatal' });

const audio = { inlineData: { data: Buffer.alloc(3200).toString('base64'), mimeType: 'audio/pcm' } };

describe('isBareCompletion', () => {
  it('flags completion-only messages', () => {
    assert.equal(isBareCompletion({ serverContent: { generationComplete: true } }), true);
    assert.equal(isBareCompletion({ serverContent: { turnComplete: true } }), true);
  });
  it('keeps real output and tool calls', () => {
    assert.equal(isBareCompletion({ serverContent: { modelTurn: { parts: [audio] } } }), false);
    assert.equal(isBareCompletion({ serverContent: { inputTranscription: { text: 'hi' } } }), false);
    assert.equal(isBareCompletion({ toolCall: { functionCalls: [{ id: 'x' }] } }), false);
    assert.equal(isBareCompletion({ voiceActivity: { type: 'ACTIVITY_END' } }), false);
  });
});

describe('findStuckToolCalls', () => {
  const statuses = new Map([
    ['a', { name: 't', status: 'pending', createdAt: 0 }],
    ['b', { name: 't', status: 'pending', createdAt: 0 }],
  ]);
  it('waits for the grace period once a result exists', () => {
    const resultAt = (id: string) => (id === 'a' ? 1_000 : undefined);
    assert.deepEqual(
      findStuckToolCalls({ pending: ['a', 'b'], statuses, recovered: new Set(), now: 1_000 + STUCK_TOOL_RESULT_GRACE_MS - 1, resultAt }),
      [],
    );
    assert.deepEqual(
      findStuckToolCalls({ pending: ['a', 'b'], statuses, recovered: new Set(), now: 1_000 + STUCK_TOOL_RESULT_GRACE_MS, resultAt }),
      ['a'],
    );
  });
  it('gives up on a hung tool after the hard ceiling, once', () => {
    const resultAt = () => undefined;
    assert.deepEqual(
      findStuckToolCalls({ pending: ['b'], statuses, recovered: new Set(), now: STUCK_TOOL_MAX_MS, resultAt }),
      ['b'],
    );
    assert.deepEqual(
      findStuckToolCalls({ pending: ['b'], statuses, recovered: new Set(['b']), now: STUCK_TOOL_MAX_MS, resultAt }),
      [],
    );
  });
});

describe('withCachedResult', () => {
  it('stores the tool result by toolCallId', async () => {
    const wrapped = withCachedResult({
      execute: async (_args?: unknown, _opts?: { toolCallId?: string }) => ({ ok: true, say: 'hi' }),
    });
    await wrapped.execute!({}, { toolCallId: 'cache_1' });
    assert.equal(peekToolResult('cache_1')?.output, JSON.stringify({ ok: true, say: 'hi' }));
  });
});

/**
 * Replays the exact message order from the 2026-09-24 19:18 phone call through the real
 * plugin RealtimeSession: agent audio → tool call mid-speech → bare generationComplete.
 */
describe('real plugin RealtimeSession replay', () => {
  let session: PatchableSession & Record<string, any>;
  const fake = {};
  const sent: Array<{ type: string; value: any }> = [];
  let speechStarted = 0;

  const feed = async (response: object) => {
    session.activeSession = fake;
    if (session.sessionShouldClose?.isSet) session.sessionShouldClose.clear();
    await session.onReceiveMessage(fake, response);
  };

  before(() => {
    applyGeminiRealtimePatches();
    const model = new google.realtime.RealtimeModel({ apiKey: 'test', model: 'gemini-3.8-live' });
    session = model.session() as unknown as PatchableSession & Record<string, any>;
    session.on('error', () => {});
    session.on('input_speech_started', () => {
      speechStarted += 1;
    });
    const protoSend = session.sendClientEvent;
    session.sendClientEvent = function (event) {
      sent.push(event);
      return protoSend.call(this, event);
    };
  });

  after(async () => {
    await session.close().catch(() => {});
  });

  it('does not fake a caller barge-in after a mid-speech tool call', async () => {
    await feed({ voiceActivity: { type: 'ACTIVITY_END' } });
    await feed({ serverContent: { modelTurn: { parts: [audio] } } });
    const beforeTool = speechStarted;
    await feed({ toolCall: { functionCalls: [{ id: 'call_replay', name: 'lookup_hotel_availability', args: { city: 'Udaipur' } }] } });
    await feed({ serverContent: { generationComplete: true } });
    await feed({ serverContent: { turnComplete: true }, usageMetadata: { promptTokenCount: 1 } });
    assert.equal(speechStarted - beforeTool, 0);
    assert.equal(session.pendingToolCallIds.has('call_replay'), true);
  });

  it('delivers the cached result when LiveKit never sent the tool response', () => {
    rememberToolResult('call_replay', { ok: true, say: 'Udaipur mein hostel hai.' });
    const recovered = runStuckToolGuard(session, Date.now() + STUCK_TOOL_RESULT_GRACE_MS + 10);
    assert.deepEqual(recovered, ['call_replay']);
    const toolResponse = sent.find((e) => e.type === 'tool_response');
    assert.ok(toolResponse);
    assert.deepEqual(toolResponse.value.functionResponses[0], {
      id: 'call_replay',
      name: 'lookup_hotel_availability',
      response: { output: JSON.stringify({ ok: true, say: 'Udaipur mein hostel hai.' }) },
    });
    assert.deepEqual(runStuckToolGuard(session, Date.now() + 60_000), []);
  });

  it('still starts a new generation for real model audio after the tool', async () => {
    const before = speechStarted;
    await feed({ serverContent: { modelTurn: { parts: [audio] } } });
    assert.equal(speechStarted - before, 1);
  });
});

describe('armToolSpeechNudge', () => {
  it('sends one content nudge when Gemini stays silent after a tool result', async () => {
    const sent: Array<{ type: string }> = [];
    const fake = {
      sendClientEvent(event: { type: string }) {
        sent.push(event);
      },
      pendingToolCallIds: new Set<string>(),
      toolCallStatuses: new Map(),
    } as unknown as PatchableSession;
    armToolSpeechNudge(fake, Date.now(), 20);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sent.filter((e) => e.type === 'content').length, 1);
    armToolSpeechNudge(fake, Date.now(), 20);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(sent.filter((e) => e.type === 'content').length, 1);
  });

  it('does not nudge when the model already spoke in the last few seconds', async () => {
    applyGeminiRealtimePatches();
    const model = new google.realtime.RealtimeModel({ apiKey: 'test', model: 'gemini-3.8-live' });
    const session = model.session() as unknown as PatchableSession & Record<string, any>;
    session.on('error', () => {});
    const sent: Array<{ type: string }> = [];
    const protoSend = session.sendClientEvent.bind(session);
    session.sendClientEvent = (event: { type: string; value: unknown }) => {
      sent.push(event);
      return protoSend(event);
    };
    session.activeSession = {};
    await session.onReceiveMessage(session.activeSession, {
      serverContent: { modelTurn: { parts: [audio] } },
    });
    armToolSpeechNudge(session, Date.now(), 20);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sent.filter((e) => e.type === 'content').length, 0);
    await session.close().catch(() => {});
  });
});
