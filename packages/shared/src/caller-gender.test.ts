import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  genderFromFirstPersonVerbs,
  genderFromGivenName,
  inferCallerGender,
  buildCallerGenderSystemNote,
} from './caller-gender.ts';

describe('genderFromGivenName', () => {
  it('does not guess unisex or STT-ambiguous names', () => {
    assert.equal(genderFromGivenName('Shubham'), 'unknown');
    assert.equal(genderFromGivenName('Shuman'), 'unknown');
    assert.equal(genderFromGivenName('Suman ji'), 'unknown');
    assert.equal(genderFromGivenName('Kiran'), 'unknown');
  });

  it('classifies clearly gendered Indian first names', () => {
    assert.equal(genderFromGivenName('Priya'), 'female');
    assert.equal(genderFromGivenName('Rahul'), 'male');
  });

  it('leaves unknown spellings unknown', () => {
    assert.equal(genderFromGivenName('Xyzabc'), 'unknown');
    assert.equal(genderFromGivenName(''), 'unknown');
  });
});

describe('genderFromFirstPersonVerbs', () => {
  it('reads feminine first-person Hinglish', () => {
    assert.equal(genderFromFirstPersonVerbs('Main room book karti hoon'), 'female');
    assert.equal(genderFromFirstPersonVerbs('Kal aaungi'), 'female');
  });

  it('reads masculine first-person Hinglish', () => {
    assert.equal(genderFromFirstPersonVerbs('Main check karta hun'), 'male');
    assert.equal(genderFromFirstPersonVerbs('Main jaunga kal'), 'male');
  });

  it('does not treat third-person karta hai as the caller', () => {
    assert.equal(genderFromFirstPersonVerbs('Guest karta hai late check-in'), 'unknown');
  });
});

describe('inferCallerGender', () => {
  it('lets verbs override a unisex name', () => {
    assert.equal(
      inferCallerGender({ spokenText: 'Main book karti hoon', name: 'Shubham' }),
      'female',
    );
    assert.equal(
      inferCallerGender({ spokenText: 'Main book karta hun', name: 'Shuman' }),
      'male',
    );
  });

  it('keeps previous gender when this turn has no verb cue', () => {
    assert.equal(
      inferCallerGender({ spokenText: 'haan theek hai', name: 'Suman', previous: 'female' }),
      'female',
    );
  });

  it('stays unknown for unisex name with no verbs', () => {
    assert.equal(inferCallerGender({ spokenText: 'hello', name: 'Shubham' }), 'unknown');
  });
});

describe('buildCallerGenderSystemNote', () => {
  it('forbids asking gender when unknown', () => {
    const note = buildCallerGenderSystemNote('unknown', 'Shubham');
    assert.match(note, /unknown/i);
    assert.match(note, /Never ask/i);
    assert.match(note, /Shubham ji/i);
  });
});
