import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeUserUtterance, isSameUtteranceContinuation, isNearDuplicateUtterance } from './user-turn-endpoint.ts';

describe('mergeUserUtterance', () => {
  it('joins two finals 500ms apart into one turn', () => {
    assert.equal(mergeUserUtterance('Mujhe Taigun', 'ka price chahiye'), 'Mujhe Taigun ka price chahiye');
  });

  it('grows when the next segment is a longer prefix of the same utterance', () => {
    assert.equal(
      mergeUserUtterance('Mujhe Taigun', 'Mujhe Taigun ka price chahiye'),
      'Mujhe Taigun ka price chahiye',
    );
  });

  it('keeps the longer copy when Azure repeats the same words', () => {
    assert.equal(mergeUserUtterance('price kya hai', 'price kya hai?'), 'price kya hai?');
    assert.equal(mergeUserUtterance('price kya hai?', 'price kya hai'), 'price kya hai?');
  });

  it('does not duplicate a fragment already contained in the buffer', () => {
    assert.equal(mergeUserUtterance('Mujhe Taigun ka price chahiye', 'Taigun'), 'Mujhe Taigun ka price chahiye');
  });
});

describe('isSameUtteranceContinuation', () => {
  it('folds Azure growing prefixes of the same utterance', () => {
    assert.equal(
      isSameUtteranceContinuation('kya bolte hain', 'kya bolte hain हाँ नेहा क्या बोल रहे हैं'),
      true,
    );
  });

  it('does not glue a new topic onto a finished question', () => {
    assert.equal(
      isSameUtteranceContinuation(
        'Samajh gayi sedan dekh rahe hain',
        'toh maam aapke paas idea hoga',
        { msSinceCommit: 2_000 },
      ),
      false,
    );
  });

  it('still folds hanging fragments in the same breath', () => {
    assert.equal(
      isSameUtteranceContinuation('हैलो, मैंने।', 'हैलो मैंने sedan dekh raha tha', { msSinceCommit: 200 }),
      true,
    );
  });
});

describe('isNearDuplicateUtterance', () => {
  it('detects the same Udaipur ask with noisy STT prefixes stripped by overlap', () => {
    assert.equal(
      isNearDuplicateUtterance(
        'ਜੀ कि कोई property Udaipur में भी है क्या',
        'कि कोई property Udaipur में भी है क्या',
      ),
      true,
    );
  });

  it('allows a clearly new pricing ask after location', () => {
    assert.equal(
      isNearDuplicateUtterance(
        'Udaipur mein property hai kya',
        'Mujhe Taigun ka on road price chahiye please batao',
      ),
      false,
    );
  });
});
