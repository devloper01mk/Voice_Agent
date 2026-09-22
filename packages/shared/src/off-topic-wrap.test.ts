import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCallPurposeSystemNote,
  buildOffTopicRedirectSystemNote,
  isCallPurposeOrIdentityTurn,
  isLikelyOffTopicOrPersonalTurn,
} from './off-topic-wrap.ts';

describe('buildOffTopicRedirectSystemNote', () => {
  it('uses Roman Hinglish guidance by default without forcing Maaf kijiye', () => {
    const note = buildOffTopicRedirectSystemNote({
      productName: 'Virtus',
      strike: 1,
      maxRedirects: 2,
      forceAtStrike: 3,
    });
    assert.match(note, /Roman Hinglish/);
    assert.match(note, /vary the opening/);
    assert.match(note, /not always "Maaf kijiye"/);
    assert.match(note, /Never treat brand complaints/);
  });

  it('uses English guidance for English call language', () => {
    const note = buildOffTopicRedirectSystemNote({
      productName: 'Virtus',
      strike: 1,
      maxRedirects: 2,
      forceAtStrike: 3,
      speechLanguage: 'en',
    });
    assert.match(note, /short English reply/);
    assert.doesNotMatch(note, /Roman Hinglish/);
  });
});

describe('isLikelyOffTopicOrPersonalTurn', () => {
  it('does not treat scheduling with subah/shaam as off-topic', () => {
    assert.equal(isLikelyOffTopicOrPersonalTurn('kal subah do baje call kariye'), false);
    assert.equal(isLikelyOffTopicOrPersonalTurn('kal shaam saat baje call kariye'), false);
  });

  it('still flags personal morning chitchat', () => {
    assert.equal(isLikelyOffTopicOrPersonalTurn('aapne subah kya khaya'), true);
    assert.equal(isLikelyOffTopicOrPersonalTurn('subah chai piyi'), true);
  });

  it('does not treat online brand complaints as personal off-topic', () => {
    assert.equal(isLikelyOffTopicOrPersonalTurn('bahut saare complain maine dekhe hain'), false);
    assert.equal(isLikelyOffTopicOrPersonalTurn('bahut saare complaint dekhe online'), false);
  });

  it('does not treat Google rating / dating STT mishear with car context as off-topic', () => {
    assert.equal(isLikelyOffTopicOrPersonalTurn('google pe rating bahut kharab hai'), false);
    assert.equal(
      isLikelyOffTopicOrPersonalTurn('Volkswagen ka dating dekha hai google pe bahut kharab'),
      false,
    );
    assert.equal(isLikelyOffTopicOrPersonalTurn('डेटिंग देखा हूँ गूगल पर बहुत खराब'), false);
  });

  it('still flags clearly flirty dating asks', () => {
    assert.equal(isLikelyOffTopicOrPersonalTurn('aapke saath date pe chaloge'), true);
    assert.equal(isLikelyOffTopicOrPersonalTurn('milna hai aapse girlfriend banogi'), true);
  });

  it('keeps warranty and free service questions on-call', () => {
    assert.equal(isLikelyOffTopicOrPersonalTurn('kitne free services milte hain warranty mein'), false);
    assert.equal(isLikelyOffTopicOrPersonalTurn('showroom kahan pe hai Bihar'), false);
  });

  it('does not treat why-you-called as off-topic', () => {
    assert.equal(isLikelyOffTopicOrPersonalTurn('aapne call kyon kiya'), false);
    assert.equal(isLikelyOffTopicOrPersonalTurn('Kaafi aapko call kyonki hai'), false);
    assert.equal(isLikelyOffTopicOrPersonalTurn('बट आपने कॉल किया क्यों?'), false);
    assert.equal(isLikelyOffTopicOrPersonalTurn('अब आप कॉल इसलिए है'), false);
  });
});

describe('isCallPurposeOrIdentityTurn', () => {
  it('detects who/why-calling asks including STT garbage', () => {
    assert.equal(isCallPurposeOrIdentityTurn('aapne call kyon kiya'), true);
    assert.equal(isCallPurposeOrIdentityTurn('Kaafi aapko call kyonki hai'), true);
    assert.equal(isCallPurposeOrIdentityTurn('बट आपने कॉल किया क्यों?'), true);
    assert.equal(isCallPurposeOrIdentityTurn('kaun bol rahi ho'), true);
    assert.equal(isCallPurposeOrIdentityTurn('why did you call'), true);
    assert.equal(isCallPurposeOrIdentityTurn('call kahan se kar rahe ho'), true);
    assert.equal(isCallPurposeOrIdentityTurn('यह कहाँ से बोल रहे हो'), true);
    assert.equal(isCallPurposeOrIdentityTurn('kis kshetra se call hai'), true);
    assert.equal(isCallPurposeOrIdentityTurn('call me later'), false);
    assert.equal(isCallPurposeOrIdentityTurn('Virtus ka price kya hai'), false);
  });

  it('purpose note forbids hangup', () => {
    const note = buildCallPurposeSystemNote('Volkswagen India');
    assert.match(note, /IDENTITY/);
    assert.match(note, /NEVER call end_call/);
    assert.match(note, /Volkswagen India/);
  });
});
