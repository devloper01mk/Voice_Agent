import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOffTopicRedirectSystemNote } from './off-topic-wrap.ts';
import { buildSpeechLanguageSystemNote } from './call-language.ts';
import {
  stripSystemNotesForDisplay,
  stripAgentToolNoiseForDisplay,
  sanitizeSpokenHistoryForLlm,
} from './strip-system-notes.ts';

describe('stripSystemNotesForDisplay', () => {
  it('keeps plain user text unchanged', () => {
    assert.equal(stripSystemNotesForDisplay('Virtus ka price kya hai?'), 'Virtus ka price kya hai?');
  });

  it('strips off-topic + CALL LANGUAGE notes, leaves caller text', () => {
    const user = 'माम् आपने फ़ोन क्यों किया है?';
    const offTopic = buildOffTopicRedirectSystemNote({
      productName: 'Volkswagen India',
      strike: 1,
      maxRedirects: 5,
      forceAtStrike: 6,
    });
    const lang = buildSpeechLanguageSystemNote('hinglish');
    const mutated = `${user}\n\n${offTopic}\n\n${lang}`;
    assert.equal(stripSystemNotesForDisplay(mutated), user);
  });

  it('strips inline SYSTEM blocks without requiring newlines', () => {
    const raw =
      'Maam aapne phone kyun kiya hai? [SYSTEM: Off-topic or personal chitchat (strike 1). Decline briefly.]';
    assert.equal(stripSystemNotesForDisplay(raw), 'Maam aapne phone kyun kiya hai?');
  });

  it('strips EMAIL PROTOCOL notes that use [System: casing', () => {
    const user = 'एक बी एम. मैडम मैडम';
    const note =
      '[System: EMAIL PROTOCOL — unclear yes/no on USERNAME "a.b". Do NOT stay silent. Reply in Hinglish (Roman). Ask haan/sahi ya galat/nahi. Do NOT re-read the full username unless they ask. FIELDS local=a.b(open) domain=(none)]';
    assert.equal(stripSystemNotesForDisplay(`${user} ${note}`), user);
    assert.equal(stripSystemNotesForDisplay(`${user}\n\n${note}`), user);
  });

  it('strips PHONE PROTOCOL notes', () => {
    const user = '8083156450';
    const note =
      '[System: PHONE PROTOCOL — caller is giving a phone number. Digits only: if letters appear (not spoken digit words), do NOT note/save — ask again for 10 digits.]';
    assert.equal(stripSystemNotesForDisplay(`${user} ${note}`), user);
  });

  it('strips CALL FACTS notes', () => {
    const user = 'Number showroom pe dekh lunga';
    const note =
      '[System: CALL FACTS THIS CALL — already known: city=Jaipur; preferred_time=today 5 PM. NEVER re-ask any known fact.]';
    assert.equal(stripSystemNotesForDisplay(`${user}\n\n${note}`), user);
  });
});

describe('stripAgentToolNoiseForDisplay', () => {
  it('keeps a clean goodbye', () => {
    const bye =
      'Theek hai, no problem! Jab bhi aapka plan ready ho, humein batayiyega. Aapka din shubh ho! Bye!';
    assert.equal(stripAgentToolNoiseForDisplay(bye), bye);
  });

  it('strips Gemini end_call parse errors glued after goodbye', () => {
    const raw =
      "Theek hai, no problem! Aapka din shubh ho! Bye!The previous function call could not be parsed. Fix the function call syntax to match the expected format. ParsingError: Failed to parse function call: Function call is missing the required 'call:' prefix. Got: 'Text being parsed is: Thik hai,";
    assert.equal(
      stripAgentToolNoiseForDisplay(raw),
      'Theek hai, no problem! Aapka din shubh ho! Bye!',
    );
  });
});

describe('sanitizeSpokenHistoryForLlm', () => {
  it('strips prior user System notes and keeps the latest notepad', () => {
    const prior =
      'Jaipur hai\n\n[System: CALL FACTS THIS CALL — already known: city=Jaipur. NEVER re-ask any known fact.]';
    const latest =
      '5 PM\n\n[System: CALL FACTS THIS CALL — already known: city=Jaipur; preferred_time=today 5 PM. NEVER re-ask any known fact.]';
    const history = [
      { role: 'assistant', content: 'Namaste' },
      { role: 'user', content: prior },
      { role: 'assistant', content: 'Kab convenient rahega?' },
      { role: 'user', content: latest },
    ];
    const cleaned = sanitizeSpokenHistoryForLlm(history);
    assert.equal(cleaned[1]?.content, 'Jaipur hai');
    assert.equal(cleaned[3]?.content, latest);
  });
});
