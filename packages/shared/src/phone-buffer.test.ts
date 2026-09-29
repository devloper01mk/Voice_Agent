import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildNameRecoverySystemNote,
  detectLeadingDigitPatch,
  emptyPhoneBuffer,
  ingestPhoneUtterance,
  looksLikeNameMissComplaint,
  mergePhoneDigits,
} from './phone-buffer.ts';
import { buildContactConfirmPrompt } from './contact-confirm.ts';
import { normalizeSpokenPhone } from './phone-utils.ts';

describe('mergePhoneDigits (Indian notepad)', () => {
  it('acks partial then merges remainder with shared boundary digit', () => {
    const first = mergePhoneDigits('', '8306');
    assert.equal(first.digits, '8306');
    assert.equal(first.kind, 'partial');

    // 8306 + 6446999 → overlap on trailing/leading 6 → 8306446999
    const second = mergePhoneDigits('8306', '6446999');
    assert.equal(second.digits, '8306446999');
    assert.equal(second.kind, 'complete');
  });

  it('appends non-overlapping chunks under 10', () => {
    const r = mergePhoneDigits('98', '76543210');
    assert.equal(r.digits, '9876543210');
    assert.equal(r.kind, 'complete');
  });

  it('flags conflicting full numbers instead of silent switch', () => {
    const r = mergePhoneDigits('8306446999', '7277700678');
    assert.equal(r.kind, 'conflict');
    assert.equal(r.digits, '8306446999');
    assert.equal(r.conflictWith, '7277700678');
  });
});

describe('ingestPhoneUtterance', () => {
  it('builds notepad across the failed VW transcript pattern', () => {
    let state = emptyPhoneBuffer();

    let r = ingestPhoneUtterance(state, '8306');
    state = r.state;
    assert.equal(state.digits, '8306');
    assert.equal(r.kind, 'partial');
    assert.match(r.systemNote, /PHONE PROTOCOL/i);
    assert.match(r.systemNote, /Aage ke|remaining/i);
    assert.match(r.systemNote, /NEVER invent/i);
    assert.match(r.systemNote, /Roman Hinglish|Hinglish/i);
    assert.match(r.systemNote, /NEVER default to.*"I'm still not getting/i);

    r = ingestPhoneUtterance(state, '6446999');
    state = r.state;
    assert.equal(state.digits, '8306446999');
    assert.equal(r.kind, 'complete');
    assert.match(r.systemNote, /eight three|Speak these digit words VERBATIM/i);
    assert.match(r.systemNote, /Never say double\/triple/i);
  });

  it('patches leading missing digit without full reset', () => {
    let state = emptyPhoneBuffer();
    state = ingestPhoneUtterance(state, '306446999').state;
    assert.equal(state.digits, '306446999');
    assert.equal(state.digits.length, 9);

    const r = ingestPhoneUtterance(state, 'aage 8 nahi laga');
    assert.equal(r.state.digits, '8306446999');
    assert.equal(r.kind, 'complete');
  });

  it('never invents a 10th digit on short input', () => {
    const r = ingestPhoneUtterance(emptyPhoneBuffer(), '306446999');
    assert.equal(r.state.digits, '306446999');
    assert.equal(r.kind, 'partial');
    assert.equal(r.state.digits.length, 9);
  });

  it('escalates after repeated conflicts', () => {
    let state = emptyPhoneBuffer();
    state = ingestPhoneUtterance(state, '8306446999').state;
    let r = ingestPhoneUtterance(state, '7277700678');
    state = r.state;
    r = ingestPhoneUtterance(state, '9876543210');
    state = r.state;
    r = ingestPhoneUtterance(state, '9123456789');
    assert.ok(r.state.failedAttempts >= 3);
    assert.equal(r.kind, 'escalate');
    assert.match(r.systemNote, /WhatsApp|callback|escalate/i);
  });
});

describe('detectLeadingDigitPatch', () => {
  it('parses aage / pehle missing-digit cues', () => {
    assert.equal(detectLeadingDigitPatch('aage 8 nahi laga'), '8');
    assert.equal(detectLeadingDigitPatch('pehle eight'), '8');
    assert.equal(detectLeadingDigitPatch('8 aage mein nahi laga'), '8');
  });
});

describe('looksLikeNameMissComplaint', () => {
  it('detects the VW call complaint', () => {
    assert.equal(looksLikeNameMissComplaint('माम् आपने नाम तो पूछा ही नहीं।'), true);
    assert.equal(looksLikeNameMissComplaint('aapne naam nahi poocha'), true);
    assert.equal(looksLikeNameMissComplaint('Taigun ka price kya hai'), false);
  });

  it('name recovery note asks for name immediately', () => {
    const note = buildNameRecoverySystemNote();
    assert.match(note, /NAME RECOVERY/);
    assert.match(note, /Ask full name NOW/i);
    assert.match(note, /update_demo_lead_name/);
    assert.match(note, /Do NOT pivot to car\/model/i);
  });
});

describe('Devanagari eight in normalizeSpokenPhone', () => {
  it('maps एट to 8', () => {
    assert.equal(normalizeSpokenPhone('एट 306'), '8306');
  });
});

describe('contact-confirm tool safety', () => {
  it('keeps digit safety without a spoken script', () => {
    const prompt = buildContactConfirmPrompt({});
    assert.match(prompt, /Never invent digits/i);
    assert.match(prompt, /not a required conversation path/i);
    assert.doesNotMatch(prompt, /Maine suna \{name\}/);
  });
});
