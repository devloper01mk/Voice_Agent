import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assistantEndedWithQuestion,
  buildFeelSystemNote,
  emptyConversationFeel,
  extractLeadingOpener,
  extractSalesBridge,
  openerFamily,
  rememberAgentOpener,
} from './conversation-feel.js';

describe('conversation-feel', () => {
  it('extracts leading soft openers and acks as families', () => {
    assert.equal(extractLeadingOpener('Hmm… yeh do option hain.'), 'hmm');
    assert.equal(extractLeadingOpener('Samajh gaya. Price around 12 lakh hai.'), 'samajh gaya');
    assert.equal(extractLeadingOpener('Samajh gayi. Online complaints dikh jaati hain.'), 'samajh gaya');
    assert.equal(extractLeadingOpener('Dekhta hoon zara. Pehle feature, phir price.'), 'dekhta hoon zara');
    assert.equal(extractLeadingOpener('Ji, next step yeh hoga.'), 'ji');
    assert.equal(extractLeadingOpener('Ji bilkul, time confirm hai.'), 'ji');
    assert.equal(extractLeadingOpener('Got it. Sunday 11 works.'), 'got it');
  });

  it('treats samajh gaya and samajh gayi as the same family', () => {
    assert.equal(openerFamily('samajh gayi'), 'samajh gaya');
    assert.equal(openerFamily('Samajh gaya'), 'samajh gaya');
  });

  it('returns null when the reply starts with substance', () => {
    assert.equal(extractLeadingOpener('Creta ka on-road roughly 12 lakh hai.'), null);
    assert.equal(extractLeadingOpener('Sunday subah 11 baje demo book karun?'), null);
    assert.equal(extractLeadingOpener(''), null);
  });

  it('detects sales bridges', () => {
    assert.equal(
      extractSalesBridge('Taigun aur Virtus hain. Agar aap chahen, main shortlist bataun.'),
      'agar aap chahen',
    );
    assert.equal(
      extractSalesBridge('Warranty covers service. If you want, I can explain what is covered.'),
      'if you want',
    );
    assert.equal(extractSalesBridge('Price around 12 lakh hai.'), null);
  });

  it('detects when assistant ended with a discovery question', () => {
    assert.equal(assistantEndedWithQuestion('Aapka budget roughly kitna hai?'), true);
    assert.equal(assistantEndedWithQuestion('Aap sedan dekh rahe hain ya SUV?'), true);
    assert.equal(assistantEndedWithQuestion('Aap petrol chahte hain ya automatic preference hai?'), true);
    assert.equal(assistantEndedWithQuestion('Jaipur mein showroom options mil jayenge.'), false);
    assert.equal(assistantEndedWithQuestion('Budget mein entry variants practical rahenge.'), false);
  });

  it('remembers recent openers and bridges without exceeding two', () => {
    let state = emptyConversationFeel();
    state = rememberAgentOpener(state, 'Samajh gayi. Done. Agar aap chahen bataun.');
    state = rememberAgentOpener(state, 'Hmm… next point.');
    state = rememberAgentOpener(state, 'Theek hai — last one. If you want I can book.');
    assert.deepEqual(state.recentOpeners, ['hmm', 'theek hai']);
    assert.deepEqual(state.recentBridges, ['agar aap chahen', 'if you want']);
    assert.equal(state.lastEndedWithQuestion, false);
  });

  it('tracks lastEndedWithQuestion across remembered turns', () => {
    let state = emptyConversationFeel();
    state = rememberAgentOpener(state, 'Aapka budget roughly kitna hai?');
    assert.equal(state.lastEndedWithQuestion, true);
    state = rememberAgentOpener(state, 'Budget mein used options practical rahenge.');
    assert.equal(state.lastEndedWithQuestion, false);
  });

  it('collapses gendered samajh openers when remembering across barge-in restarts', () => {
    let state = emptyConversationFeel();
    state = rememberAgentOpener(state, 'Samajh gayi. Online complaints dikh jaati hain');
    state = rememberAgentOpener(state, 'Samajh gayi. Online complaints dikhne se concern');
    assert.deepEqual(state.recentOpeners, ['samajh gaya', 'samajh gaya']);
    const note = buildFeelSystemNote(state);
    assert.match(note, /samajh gaya/);
    assert.match(note, /going straight to the useful answer/);
  });

  it('ignores substance-only replies when remembering openers', () => {
    let state = emptyConversationFeel();
    state = rememberAgentOpener(state, 'Price 12 lakh hai.');
    assert.deepEqual(state.recentOpeners, []);
    assert.deepEqual(state.recentBridges, []);
    assert.equal(state.lastEndedWithQuestion, false);
  });

  it('builds a system note listing recent openers and a suggested alternate', () => {
    const state = {
      recentOpeners: ['samajh gaya', 'hmm'],
      recentBridges: ['agar aap chahen'],
      lastEndedWithQuestion: false,
    };
    const note = buildFeelSystemNote(state);
    assert.match(note, /\[SYSTEM:/);
    assert.match(note, /"samajh gaya"/);
    assert.match(note, /"hmm"/);
    assert.match(note, /do not open with/);
    assert.match(note, /going straight to the useful answer/);
    assert.match(note, /agar aap chahen/);
  });

  it('nudges against chained discovery questions', () => {
    const note = buildFeelSystemNote({
      recentOpeners: [],
      recentBridges: [],
      lastEndedWithQuestion: true,
    });
    assert.match(note, /previous turn ended with a discovery question/);
    assert.match(note, /value beat/);
    assert.match(note, /chalega/);
    assert.match(note, /two concrete choices/);
  });

  it('returns empty system note when nothing recent', () => {
    assert.equal(buildFeelSystemNote(emptyConversationFeel()), '');
  });
});
