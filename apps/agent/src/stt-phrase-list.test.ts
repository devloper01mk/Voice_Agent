import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSttPhraseList } from './stt-phrase-list.js';

describe('buildSttPhraseList', () => {
  it('prioritizes email spelling control words and phonetics', () => {
    const phrases = buildSttPhraseList('Test Product');
    for (const phrase of [
      'letter by letter',
      'double',
      'triple',
      'dot com',
      'underscore',
      'hyphen',
      'plus',
      'ell',
      'why',
    ]) {
      assert.equal(phrases.includes(phrase), true, `missing phrase: ${phrase}`);
    }
  });
});
