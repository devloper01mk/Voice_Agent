import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assembleSttPhraseList, isVolkswagenProduct } from './stt-phrase-list.ts';
import { buildSttPhraseList } from './index.ts';

describe('buildSttPhraseList', () => {
  it('prioritizes email spelling control words and phonetics', () => {
    const phrases = assembleSttPhraseList('Test Product');
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

  it('boosts the agent product name and not Volkswagen for other products', () => {
    const phrases = assembleSttPhraseList('Cronberry');
    assert.equal(phrases.includes('Cronberry'), true);
    assert.equal(phrases.includes('cronberry'), true);
    assert.equal(phrases.includes('Volkswagen'), false);
    assert.equal(phrases.includes('Taigun'), false);
    assert.equal(phrases.includes('Virtus'), false);
    assert.equal(phrases.includes('sedan'), false);
    assert.equal(phrases.includes('सेडान'), false);
  });

  it('boosts VW model names only for Volkswagen products', () => {
    assert.equal(isVolkswagenProduct('Volkswagen India'), true);
    assert.equal(isVolkswagenProduct('VW'), true);
    assert.equal(isVolkswagenProduct('Cronberry'), false);

    const phrases = assembleSttPhraseList('Volkswagen');
    assert.equal(phrases.includes('Volkswagen'), true);
    assert.equal(phrases.includes('Taigun'), true);
    assert.equal(phrases.includes('Virtus'), true);
    assert.equal(phrases.includes('sedan'), true);
    assert.equal(phrases.includes('सेडान'), true);
  });

  it('includes known email domains from merged skills', () => {
    const phrases = buildSttPhraseList('Cronberry');
    assert.equal(phrases.includes('cronberry.com'), true);
  });
});
