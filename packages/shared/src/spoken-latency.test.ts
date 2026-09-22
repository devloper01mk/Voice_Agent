import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractNewSpokenChunks,
  normalizeHeard,
  shouldSpeculateOnInterim,
  speculativeHeardMatch,
} from './spoken-latency.ts';

describe('shouldSpeculateOnInterim', () => {
  it('starts on product asks and questions', () => {
    assert.equal(shouldSpeculateOnInterim('price'), true);
    assert.equal(shouldSpeculateOnInterim('कीमत'), true);
    assert.equal(shouldSpeculateOnInterim('kitna hai?'), true);
    assert.equal(shouldSpeculateOnInterim('features batao'), true);
  });

  it('does not start on acks, stop, or go-ahead', () => {
    assert.equal(shouldSpeculateOnInterim('ok'), false);
    assert.equal(shouldSpeculateOnInterim('haan'), false);
    assert.equal(shouldSpeculateOnInterim('theek hai'), false);
    assert.equal(shouldSpeculateOnInterim('ruko'), false);
    assert.equal(shouldSpeculateOnInterim('boliye'), false);
  });
});

describe('speculativeHeardMatch', () => {
  it('matches same ask and short continuations', () => {
    assert.equal(speculativeHeardMatch('price', 'price?'), true);
    assert.equal(speculativeHeardMatch('price', 'price kya hai'), true);
    assert.equal(speculativeHeardMatch('kitna', 'kitna hai on road'), true);
  });

  it('rejects a different question', () => {
    assert.equal(speculativeHeardMatch('price', 'features batao'), false);
    assert.equal(speculativeHeardMatch('price', 'mileage kya hai compare karo details'), false);
  });
});

describe('extractNewSpokenChunks', () => {
  it('emits punctuation sentences and skips decimals', () => {
    const partial = extractNewSpokenChunks('On-road 12.5 lakh hai. Dusri', 0, false);
    assert.deepEqual(partial.chunks, ['On-road 12.5 lakh hai.']);
    const full = extractNewSpokenChunks('On-road 12.5 lakh hai. Dusri line.', partial.cursor, false);
    assert.deepEqual(full.chunks, ['Dusri line.']);
  });

  it('does not cut mid-sentence just because there are many words', () => {
    const words = Array.from({ length: 12 }, (_, i) => `w${i + 1}`).join(' ');
    const mid = extractNewSpokenChunks(words, 0, false);
    assert.deepEqual(mid.chunks, []);
    const done = extractNewSpokenChunks(`${words}.`, 0, false);
    assert.deepEqual(done.chunks, [`${words}.`]);
  });

  it('flushes the remainder on end', () => {
    const got = extractNewSpokenChunks('Short reply', 0, true);
    assert.deepEqual(got.chunks, ['Short reply']);
  });

  it('does not flush a streaming 1. before the 0 arrives', () => {
    const mid = extractNewSpokenChunks('usually Taigun ka 1.', 0, false);
    assert.deepEqual(mid.chunks, []);
    const rest = extractNewSpokenChunks(
      'usually Taigun ka 1.0L TSI kaafi practical rehta hai.',
      mid.cursor,
      false,
    );
    assert.deepEqual(rest.chunks, ['usually Taigun ka 1.0L TSI kaafi practical rehta hai.']);
  });

  it('keeps 1. then 0L as one chunk instead of two TTS turns', () => {
    const got = extractNewSpokenChunks(
      'usually Taigun ka 1.\n0L TSI kaafi practical rehta hai.',
      0,
      false,
    );
    assert.deepEqual(got.chunks, ['usually Taigun ka 1.\n0L TSI kaafi practical rehta hai.']);
  });
});

describe('normalizeHeard', () => {
  it('strips punctuation so price? matches price', () => {
    assert.equal(normalizeHeard('Price?'), 'price');
  });
});
