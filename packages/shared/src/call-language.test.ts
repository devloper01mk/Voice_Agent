import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendLanguageGuidanceIfChanged,
  buildLanguageLockSystemNote,
  buildSpeechLanguageSystemNote,
  effectiveSpeechLanguage,
  inferTurnSpeechLanguage,
  isExplicitEnglishRequest,
  isExplicitHinglishOrHindiRequest,
  languageGuidanceKey,
  speechLanguageFromSttLocale,
  updateCallLanguageLock,
  updateSoftSpeechLanguage,
} from './call-language.ts';

describe('isExplicitEnglishRequest', () => {
  it('detects clear English switch requests', () => {
    assert.equal(isExplicitEnglishRequest("Ma'am, can we talk in English?"), true);
    assert.equal(isExplicitEnglishRequest('can we talk in english'), true);
    assert.equal(isExplicitEnglishRequest('speak in english please'), true);
    assert.equal(isExplicitEnglishRequest('english mein baat karo'), true);
    assert.equal(isExplicitEnglishRequest('मैन कैन वी टॉक इन इंग्लिश।'), true);
  });

  it('ignores mixed product talk without explicit switch', () => {
    assert.equal(isExplicitEnglishRequest('हाँ माम् बैसिकली आई वन तो 25 रनिंग'), false);
    assert.equal(isExplicitEnglishRequest('suggest a better car under 10 lakh'), false);
    assert.equal(isExplicitEnglishRequest('my budget is ten lakh'), false);
  });
});

describe('isExplicitHinglishOrHindiRequest', () => {
  it('detects Hindi/Hinglish switch requests', () => {
    assert.equal(isExplicitHinglishOrHindiRequest('can we talk in hindi'), true);
    assert.equal(isExplicitHinglishOrHindiRequest('hindi mein baat karo'), true);
    assert.equal(isExplicitHinglishOrHindiRequest('switch to hinglish'), true);
    assert.equal(isExplicitHinglishOrHindiRequest('hindi mein batao'), true);
    assert.equal(isExplicitHinglishOrHindiRequest('english mein kyun bata rahi ho'), true);
    assert.equal(isExplicitHinglishOrHindiRequest('हिंदी में बताओ'), true);
  });
});

describe('updateCallLanguageLock', () => {
  it('locks English and stays locked on mixed turns', () => {
    let lock = updateCallLanguageLock('can we talk in english', null);
    assert.equal(lock, 'en');
    lock = updateCallLanguageLock('हाँ माम् बैसिकली आई वन तो', lock);
    assert.equal(lock, 'en');
    lock = updateCallLanguageLock('my budget is ten lakh', lock);
    assert.equal(lock, 'en');
  });

  it('switches back only on explicit Hindi request', () => {
    let lock = updateCallLanguageLock('talk in english', null);
    assert.equal(lock, 'en');
    lock = updateCallLanguageLock('hindi mein baat karo', lock);
    assert.equal(lock, 'hinglish');
  });
});

describe('inferTurnSpeechLanguage', () => {
  it('infers English from clear multi-word English turns', () => {
    assert.equal(inferTurnSpeechLanguage('Can we schedule at two o clock'), 'en');
    assert.equal(inferTurnSpeechLanguage('my budget is ten lakh'), 'en');
  });

  it('infers Hinglish from Hindi markers', () => {
    assert.equal(inferTurnSpeechLanguage('kal subah do baje call kariye'), 'hinglish');
    assert.equal(inferTurnSpeechLanguage('मुझे दस बजे कॉल करें'), 'hinglish');
  });

  it('uses STT locale when short Latin text is ambiguous', () => {
    assert.equal(inferTurnSpeechLanguage('okay sure', 'hi-IN'), 'hinglish');
    assert.equal(inferTurnSpeechLanguage('okay sure', 'en-IN'), 'en');
  });

  it('returns null for very short ambiguous turns', () => {
    assert.equal(inferTurnSpeechLanguage('ok'), null);
    assert.equal(inferTurnSpeechLanguage('yes'), null);
    assert.equal(inferTurnSpeechLanguage('Hello.', 'en-IN'), null);
  });
});

describe('updateSoftSpeechLanguage + effectiveSpeechLanguage', () => {
  it('sticks to English from caller speech until Hinglish turn', () => {
    let soft = updateSoftSpeechLanguage('Can we schedule at two o clock', null);
    assert.equal(soft, 'en');
    soft = updateSoftSpeechLanguage('ok', soft);
    assert.equal(soft, 'en');
    soft = updateSoftSpeechLanguage('haan ji theek hai', soft);
    assert.equal(soft, 'hinglish');
  });

  it('does not flip hinglish→en on Hello or short STT-locale English', () => {
    let soft = updateSoftSpeechLanguage('kal subah do baje', null);
    assert.equal(soft, 'hinglish');
    soft = updateSoftSpeechLanguage('Hello.', soft, 'en-IN');
    assert.equal(soft, 'hinglish');
    soft = updateSoftSpeechLanguage('okay sure', soft, 'en-IN');
    assert.equal(soft, 'hinglish');
    soft = updateSoftSpeechLanguage('No city driving.', soft);
    assert.equal(soft, 'hinglish');
    soft = updateSoftSpeechLanguage('OK, all good', soft);
    assert.equal(soft, 'hinglish');
  });

  it('flips hinglish→en on clear multi-word English', () => {
    let soft = updateSoftSpeechLanguage('haan ji theek hai', null);
    assert.equal(soft, 'hinglish');
    soft = updateSoftSpeechLanguage('Can we schedule at two o clock', soft);
    assert.equal(soft, 'en');
  });

  it('lock overrides soft for effective language', () => {
    assert.equal(effectiveSpeechLanguage('en', 'hinglish'), 'en');
    assert.equal(effectiveSpeechLanguage(null, 'en'), 'en');
    assert.equal(effectiveSpeechLanguage('hinglish', 'en'), 'hinglish');
  });
});

describe('appendLanguageGuidanceIfChanged', () => {
  it('injects CALL LANGUAGE once then skips identical repeats', () => {
    const first = appendLanguageGuidanceIfChanged('aap batao', null, 'hinglish', null);
    assert.match(first.content, /CALL LANGUAGE = HINGLISH/);
    assert.equal(first.injectedKey, 'soft:hinglish');

    const second = appendLanguageGuidanceIfChanged('ji', null, 'hinglish', first.injectedKey);
    assert.equal(second.content, 'ji');
    assert.doesNotMatch(second.content, /CALL LANGUAGE/);
    assert.equal(second.injectedKey, 'soft:hinglish');
  });

  it('re-injects when soft language changes', () => {
    const first = appendLanguageGuidanceIfChanged('haan', null, 'hinglish', null);
    const second = appendLanguageGuidanceIfChanged(
      'Can we schedule at two o clock',
      null,
      'en',
      first.injectedKey,
    );
    assert.match(second.content, /CALL LANGUAGE = ENGLISH/);
    assert.equal(second.injectedKey, 'soft:en');
  });

  it('injects LANGUAGE LOCK when lock is set', () => {
    const out = appendLanguageGuidanceIfChanged('hello', 'en', 'hinglish', null);
    assert.match(out.content, /LANGUAGE LOCK = ENGLISH/);
    assert.equal(out.injectedKey, 'lock:en');
    assert.equal(languageGuidanceKey('en', 'hinglish'), 'lock:en');
  });
});

describe('speechLanguageFromSttLocale', () => {
  it('maps Azure locales', () => {
    assert.equal(speechLanguageFromSttLocale('en-IN'), 'en');
    assert.equal(speechLanguageFromSttLocale('hi'), 'hinglish');
    assert.equal(speechLanguageFromSttLocale('fr-FR'), null);
  });
});

describe('buildLanguageLockSystemNote', () => {
  it('mentions English lock and numbers/time rule', () => {
    const note = buildLanguageLockSystemNote('en');
    assert.match(note, /LANGUAGE LOCK = ENGLISH/);
    assert.match(note, /two o'clock|Phone digits/i);
    assert.match(note, /never say "das"|forbidden "das"|ten lakh/i);
  });
});

describe('buildSpeechLanguageSystemNote', () => {
  it('mentions English times, natural weight, and phone digits', () => {
    const note = buildSpeechLanguageSystemNote('en');
    assert.match(note, /CALL LANGUAGE = ENGLISH/);
    assert.match(note, /two o'clock/);
    assert.match(note, /forty-five/);
    assert.match(note, /Phone, OTP, and PIN ONLY/);
  });

  it('mentions Hinglish times, natural weight, and English phone digits', () => {
    const note = buildSpeechLanguageSystemNote('hinglish');
    assert.match(note, /CALL LANGUAGE = HINGLISH/);
    assert.match(note, /do baje/);
    assert.match(note, /paintalis|forty-five/i);
    assert.match(note, /Phone, OTP, and PIN ONLY|English digit words/i);
    assert.doesNotMatch(note, /OTP, weight, height, age, PIN/);
  });
});
