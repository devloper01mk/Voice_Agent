import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCallCompletedPayload,
  inferCallSentiment,
  resolveCallDisposition,
  resolveCallIntent,
} from './call-webhook.js';

describe('resolveCallDisposition', () => {
  it('maps terminal telephony statuses', () => {
    assert.equal(resolveCallDisposition({ status: 'no-answer', transcript: null }), 'no_answer');
    assert.equal(resolveCallDisposition({ status: 'busy', transcript: null }), 'busy');
    assert.equal(resolveCallDisposition({ status: 'failed', transcript: null }), 'failed');
  });

  it('prefers booking outcomes', () => {
    assert.equal(
      resolveCallDisposition({
        status: 'completed',
        outcome: 'voicemail_left',
        transcript: { lines: [] },
      }),
      'voicemail',
    );
    assert.equal(
      resolveCallDisposition({
        status: 'completed',
        outcome: 'demo_booked',
        transcript: { lines: [] },
      }),
      'demo_booked',
    );
    assert.equal(
      resolveCallDisposition({
        status: 'completed',
        outcome: 'callback_scheduled',
        transcript: { lines: [] },
      }),
      'callback_scheduled',
    );
  });

  it('detects not interested from transcript', () => {
    assert.equal(
      resolveCallDisposition({
        status: 'completed',
        outcome: 'completed',
        transcript: {
          lines: [{ id: '1', role: 'user', text: 'Not interested, mat call karo', timestamp: 1 }],
        },
      }),
      'not_interested',
    );
  });
});

describe('inferCallSentiment', () => {
  it('returns negative for rejection phrases', () => {
    assert.equal(
      inferCallSentiment({
        lines: [{ id: '1', role: 'user', text: 'stop calling me', timestamp: 1 }],
      }),
      'negative',
    );
  });
});

describe('resolveCallIntent', () => {
  it('maps booked and wanted_but_not_booked', () => {
    assert.equal(
      resolveCallIntent({ disposition: 'demo_booked', booked: true, wantedToBook: true }),
      'booked',
    );
    assert.equal(
      resolveCallIntent({ disposition: 'completed', booked: false, wantedToBook: true }),
      'wanted_but_not_booked',
    );
  });
});

describe('buildCallCompletedPayload', () => {
  it('builds Nexora voice ingest payload shape', () => {
    const payload = buildCallCompletedPayload({
      id: 'call-1',
      agentId: 'agent-1',
      direction: 'outbound',
      source: 'click-to-call',
      status: 'completed',
      outcome: 'demo_booked',
      fromNumber: '9111',
      toNumber: '91999',
      prospectName: 'Ramesh',
      contactPhone: '91999',
      contactEmail: null,
      externalCallId: 'sid-1',
      startedAt: new Date('2026-01-01T10:00:00.000Z'),
      endedAt: new Date('2026-01-01T10:02:00.000Z'),
      transcript: {
        lines: [{ id: '1', role: 'user', text: 'Haan book kar do', timestamp: 1 }],
        metrics: { feltResponseMs: 900 },
      },
      agent: { name: 'Maya' },
      leads: [
        {
          id: 'lead-1',
          name: 'Ramesh',
          bookingType: 'stay',
          status: 'new',
          scheduledStart: new Date('2026-01-02T10:00:00.000Z'),
          scheduledEnd: new Date('2026-01-02T11:00:00.000Z'),
          preferredTime: '2 Jan 2026 3:30 PM',
          timezone: 'Asia/Kolkata',
          phone: '91999',
          email: 'pending@voice.local',
          notes: 'city: Rishikesh; state: Uttarakhand; hotel: Moustache Rishikesh',
          productInterest: 'Private Double Room',
          location: 'Rishikesh',
          source: 'voice_outbound',
        },
      ],
      callbacks: [],
    });

    assert.equal(payload.event, 'call.completed');
    assert.equal(payload.disposition, 'demo_booked');
    assert.equal(payload.user_status.booked, true);
    assert.equal(payload.user_status.wanted_to_book, true);
    assert.equal(payload.user_status.intent, 'booked');
    assert.equal(payload.user_status.goals_met, true);
    assert.equal(payload.contact.name, 'Ramesh');
    assert.ok(payload.booking);
    assert.equal(payload.booking?.city, 'Rishikesh');
    assert.equal(payload.booking?.state, 'Uttarakhand');
    assert.equal(payload.booking?.roomName, 'Private Double Room');
    assert.equal(payload.booking?.propertyName, 'Moustache Rishikesh');
    assert.equal(payload.transcript.lines.length, 1);
    assert.match(payload.summary, /booked/i);
  });
});
