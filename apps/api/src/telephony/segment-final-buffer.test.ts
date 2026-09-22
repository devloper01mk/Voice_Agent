import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSegmentedSttLatencyTuning, getTelephonyLatencyTuning } from './latency-profile.js';
import { SegmentFinalBuffer } from './segment-final-buffer.js';

describe('SegmentFinalBuffer', () => {
  it('debounces segment finals into one utterance', async () => {
    const finals: string[] = [];
    const buffer = new SegmentFinalBuffer(80, {
      onFinal: (text) => finals.push(text),
    });
    buffer.ingest('Pehla sentence.', 'segment_end');
    buffer.ingest('Doosra sentence.', 'segment_end');
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(finals.length, 1);
    assert.equal(finals[0], 'Pehla sentence. Doosra sentence.');
    buffer.close();
  });

  it('resets debounce when caller keeps speaking', async () => {
    const finals: string[] = [];
    const buffer = new SegmentFinalBuffer(100, {
      onFinal: (text) => finals.push(text),
    });
    buffer.ingest('Pehla.', 'segment_end');
    await new Promise((r) => setTimeout(r, 60));
    buffer.ingest('Doosra.', 'interim');
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(finals.length, 0);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(finals.length, 1);
    assert.equal(finals[0], 'Pehla. Doosra.');
    buffer.close();
  });

  it('skips duplicate flush within 3s', async () => {
    const finals: string[] = [];
    const buffer = new SegmentFinalBuffer(50, {
      onFinal: (text) => finals.push(text),
    });
    buffer.ingest('Hello there.', 'segment_end');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(finals.length, 1);
    buffer.ingest('Hello there.', 'segment_end');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(finals.length, 1);
    buffer.close();
  });
});

describe('getSegmentedSttLatencyTuning', () => {
  it('uses longer commit windows than base low profile', () => {
    const low = getTelephonyLatencyTuning('low');
    const segmented = getSegmentedSttLatencyTuning('low');
    assert.ok(segmented.commitCapMs > low.commitCapMs);
    assert.ok(segmented.commitCompleteMs > low.commitCompleteMs);
  });
});
