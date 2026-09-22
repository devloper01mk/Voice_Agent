import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCallFactsSystemNote,
  buildBuyingInterestSystemNote,
  buildNextStepAskSystemNote,
  callFactsSnapshot,
  detectAskedTopics,
  emptyCallFacts,
  extractCatalogModelNames,
  extractFactsFromUserTurn,
  isNextStepAskTurn,
  isProductChoiceInterestTurn,
  updateCallFactsFromTurn,
} from './call-facts.ts';

describe('detectAskedTopics', () => {
  it('detects model / city / time / sedan asks', () => {
    assert.ok(detectAskedTopics('Kaunsa Volkswagen model dekhna chahenge?').includes('model'));
    assert.ok(detectAskedTopics('Aapka city ya area bata dijiye').includes('city'));
    assert.ok(detectAskedTopics('Sedan dekh rahe hain ya SUV?').includes('bodyType'));
    assert.ok(
      detectAskedTopics('Kab convenient rahega — aaj 5 PM, 6 PM?').includes('preferred_time'),
    );
  });
});

describe('extractFactsFromUserTurn', () => {
  it('extracts Jaipur, Vaishali, showroom, 5 PM', () => {
    const a = extractFactsFromUserTurn('हाँ, जयपुर है माम्।');
    assert.equal(a.city, 'Jaipur');

    const b = extractFactsFromUserTurn('वैशाली नगर टाइम बता दीजिए।');
    assert.equal(b.area, 'Vaishali Nagar');

    const c = extractFactsFromUserTurn('मेरे को शोरूम विजिट करना था');
    assert.equal(c.intent, 'showroom_visit');

    const d = extractFactsFromUserTurn('मैं बोल रहा हूँ शाम को 5:00 बजे तक कर लीजिए।');
    assert.match(d.preferred_time ?? '', /5/i);
  });

  it('does not treat a calendar date digit as preferred_time', () => {
    const a = extractFactsFromUserTurn('और अगर मैं आपको एक्स्ट्रा 4 जून लगवाने के लिए');
    assert.equal(a.preferred_time, undefined);
    const b = extractFactsFromUserTurn('extra 4 June available nahi hai');
    assert.equal(b.preferred_time, undefined);
  });

  it('extracts model and body type', () => {
    assert.equal(extractFactsFromUserTurn('Taigun dekhna hai').model, 'Taigun');
    assert.equal(extractFactsFromUserTurn('SUV chahiye').bodyType, 'SUV');
  });
});

describe('updateCallFactsFromTurn (same-call notepad)', () => {
  it('locks city and time and builds never-reask note', () => {
    let state = emptyCallFacts();
    state = updateCallFactsFromTurn({
      state,
      userText: 'शोरूम विजिट करना था',
      lastAssistantText: 'Main aapki kaise madad kar sakti hoon?',
    });
    state = updateCallFactsFromTurn({
      state,
      userText: 'जयपुर है',
      lastAssistantText: 'Aapka city ya area bata dijiye',
    });
    state = updateCallFactsFromTurn({
      state,
      userText: 'वैशाली नगर',
      lastAssistantText: 'Kis area ke paas — Vaishali Nagar?',
    });
    state = updateCallFactsFromTurn({
      state,
      userText: 'शाम को 5 PM कर लीजिए',
      lastAssistantText: 'Aaj 10 AM, 11 AM, ya 5 PM?',
    });

    const snap = callFactsSnapshot(state);
    assert.equal(snap.facts.city, 'Jaipur');
    assert.equal(snap.facts.area, 'Vaishali Nagar');
    assert.equal(snap.facts.intent, 'showroom_visit');
    assert.match(snap.facts.preferred_time ?? '', /5/i);

    const note = buildCallFactsSystemNote(state);
    assert.ok(note);
    assert.match(note!, /CALL FACTS THIS CALL/);
    assert.match(note!, /NEVER re-ask/);
    assert.match(note!, /Jaipur/);
    assert.match(note!, /THIS CALL only/);
  });

  it('locks model so sedan/SUV rediscovery should be forbidden by note', () => {
    let state = emptyCallFacts();
    state = updateCallFactsFromTurn({
      state,
      userText: 'Taigun',
      lastAssistantText: 'Kaunsa Volkswagen dekh rahe ho?',
    });
    assert.equal(state.facts.model, 'Taigun');
    const note = buildCallFactsSystemNote(state)!;
    assert.match(note, /model=Taigun/);
    assert.match(note, /option menus already answered/);
  });

  it('locks a non-VW catalog name from Product Knowledge headings', () => {
    const knowledge = '## Cronberry\nWhatsApp campaigns.\n## Plans\nStarter at 499.';
    assert.ok(extractCatalogModelNames(knowledge).includes('Cronberry'));
    let state = emptyCallFacts();
    state = updateCallFactsFromTurn({
      state,
      userText: 'Cronberry dekhna hai',
      lastAssistantText: 'Kaunsa product dekh rahe ho?',
      catalogKnowledge: knowledge,
    });
    assert.equal(state.facts.model, 'Cronberry');
  });

  it('locks booking so the agent must not say the slot is full', () => {
    const note = buildCallFactsSystemNote({
      facts: { preferred_time: 'today 3 PM', booking: 'saved' },
      asked: new Set(),
    });
    assert.match(note!, /BOOKING LOCKED/);
    assert.match(note!, /NEVER say the slot is full/);
    assert.match(note!, /end_call/);
  });

  it('starts empty each call (fresh notepad)', () => {
    const a = emptyCallFacts();
    const b = emptyCallFacts();
    assert.deepEqual(callFactsSnapshot(a), { facts: {}, asked: [] });
    assert.deepEqual(callFactsSnapshot(b), { facts: {}, asked: [] });
  });
});

describe('product choice interest', () => {
  it('treats I will go with sedan as interest, not a close', () => {
    assert.equal(isProductChoiceInterestTurn("OK. I'll go with sedan."), true);
    assert.equal(isProductChoiceInterestTurn('SUV chahiye'), true);
    assert.equal(isProductChoiceInterestTurn('Taigun dekhna hai'), true);
    assert.equal(isProductChoiceInterestTurn('not interested'), false);
    assert.equal(isProductChoiceInterestTurn('call me later'), false);
  });

  it('detects next-step asks', () => {
    assert.equal(isNextStepAskTurn('OK, So what do you want me to do? Tell.'), true);
    assert.equal(isNextStepAskTurn('aap kya chahte ho'), true);
    assert.equal(isNextStepAskTurn('Virtus ka price kya hai'), false);
  });

  it('interest note forbids hangup', () => {
    assert.match(buildBuyingInterestSystemNote(), /BUYING INTEREST/);
    assert.match(buildBuyingInterestSystemNote(), /NEVER call end_call/);
    assert.match(buildNextStepAskSystemNote(), /NEVER call end_call/);
  });
});
