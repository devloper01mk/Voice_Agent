import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideRepeatSpeech,
  freshRepeatSpeechState,
  noteAssistantSpoke,
  noteToolResult,
  noteUserTranscript,
  noteCallerText,
  toolOutputMissingPlace,
} from './repeat-speech-guard.js';

describe('repeat speech guard', () => {
  it('allows the greeting and silence check, which we start ourselves', () => {
    const state = freshRepeatSpeechState();
    assert.equal(decideRepeatSpeech(state, { userInitiated: true }), 'allow');
  });

  it('allows one reply after the caller speaks, then drops an echo with no new words', () => {
    const state = freshRepeatSpeechState();
    noteUserTranscript(state);
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'allow');
    noteAssistantSpoke(state);
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'drop');
  });

  it('drops the second city question after "ji bataiye" when lookup had no city', () => {
    const state = freshRepeatSpeechState();
    noteUserTranscript(state);
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'allow');
    noteToolResult(state, { missingPlace: true });
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'drop');
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'drop');
  });

  it('still speaks a real city lookup when the first generation was only the tool call', () => {
    const state = freshRepeatSpeechState();
    noteUserTranscript(state);
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'allow');
    noteToolResult(state, { missingPlace: false });
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'allow');
    noteAssistantSpoke(state);
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'drop');
  });

  it('does not grant a second turn when the empty lookup returns after the reply already started', () => {
    const state = freshRepeatSpeechState();
    noteUserTranscript(state);
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'allow');
    noteToolResult(state, { missingPlace: true });
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'drop');
  });

  it('does not arm a second reply when the same caller line is recorded again', () => {
    const state = freshRepeatSpeechState();
    const seen = { last: '' };
    assert.equal(noteCallerText(state, 'हां जी, बताइए।', seen), true);
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'allow');
    noteAssistantSpoke(state);
    assert.equal(noteCallerText(state, 'हां जी, बताइए।', seen), false);
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'drop');
    assert.equal(noteCallerText(state, 'Udaipur ke baare mein bataiye.', seen), true);
    assert.equal(decideRepeatSpeech(state, { userInitiated: false }), 'allow');
  });

  it('detects the empty-city tool output', () => {
    assert.equal(
      toolOutputMissingPlace('{"ok":false,"error":"city or state is required"}'),
      true,
    );
    assert.equal(toolOutputMissingPlace('{"ok":true,"city":"Udaipur"}'), false);
  });
});
