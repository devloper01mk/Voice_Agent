import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildContinueInterruptedSystemNote,
  buildGoAheadDiscoverySystemNote,
  buildInterruptedNewQuestionNote,
  buildPoliteEndSystemNote,
  buildRefusalCloseSystemNote,
  buildAvailabilityTimelineSystemNote,
  buildTellMeMoreSystemNote,
  isAvailabilityTimelineTurn,
  isClearRefusalTurn,
  isDirectQuestionToAgent,
  isExploringOrThinkingTurn,
  isStatingConsiderationTurn,
  isGoAheadCue,
  isPermissionGrantCue,
  isPermissionGrantedTurn,
  isPoliteEndCue,
  isTellMeMoreTurn,
  isUrgentBargeInCue,
  looksLikePermissionAsk,
  looksTruncatedAssistantTurn,
  looksIncompleteUserTurn,
  userTurnCommitDelayMs,
  shouldCommitUserTurn,
  USER_TURN_INCOMPLETE_DELAY_MS,
  USER_TURN_COMPLETE_DELAY_MS,
  USER_TURN_COMMIT_CAP_MS,
  shouldBargeInOnSpeech,
  shouldSuppressAgentReply,
} from './call-patience.ts';

describe('isExploringOrThinkingTurn', () => {
  it('detects hmm and exploring muttering', () => {
    assert.equal(isExploringOrThinkingTurn('hmmm'), true);
    assert.equal(isExploringOrThinkingTurn('maam aise hai na'), true);
    assert.equal(isExploringOrThinkingTurn('achha achha'), true);
    assert.equal(isExploringOrThinkingTurn('dekh raha hoon'), true);
    assert.equal(isExploringOrThinkingTurn('ek minute dekhta hoon'), true);
  });

  it('does not treat direct product questions as exploring', () => {
    assert.equal(isExploringOrThinkingTurn('Virtus ka price kya hai?'), false);
    assert.equal(isExploringOrThinkingTurn('Taigun ki EMI batao'), false);
  });

  it('does not treat looking-at a category as exploring silence', () => {
    assert.equal(isStatingConsiderationTurn('SUV dekh raha tha'), true);
    assert.equal(isStatingConsiderationTurn('Rahul can ISUV dekh raha tha.'), true);
    assert.equal(isStatingConsiderationTurn('Mein issue bhee dekh raha tha SUV Mein SUV dekh raha tha.'), true);
    assert.equal(isStatingConsiderationTurn('dekh raha hoon'), false);
    assert.equal(isExploringOrThinkingTurn('SUV dekh raha tha'), false);
    assert.equal(isExploringOrThinkingTurn('dekh raha hoon'), true);
  });
});

describe('isDirectQuestionToAgent', () => {
  it('detects clear questions', () => {
    assert.equal(isDirectQuestionToAgent('Virtus ka price kya hai?'), true);
    assert.equal(isDirectQuestionToAgent('Virtus ki price batao'), true);
    assert.equal(isDirectQuestionToAgent('demo book karna hai'), true);
    assert.equal(isDirectQuestionToAgent('what is the on road price'), true);
    assert.equal(isDirectQuestionToAgent('price'), true);
    assert.equal(isDirectQuestionToAgent('कीमत'), true);
  });

  it('treats go-ahead cues as speak-now (including Devanagari)', () => {
    assert.equal(isDirectQuestionToAgent('boliye'), true);
    assert.equal(isDirectQuestionToAgent('बोलिए'), true);
    assert.equal(isDirectQuestionToAgent('ji boliye'), true);
  });

  it('does not treat exploring as a question', () => {
    assert.equal(isDirectQuestionToAgent('hmmm aise hai na'), false);
    assert.equal(isDirectQuestionToAgent('dekh raha hoon'), false);
  });
});

describe('shouldSuppressAgentReply', () => {
  it('suppresses exploring but not product questions', () => {
    assert.equal(shouldSuppressAgentReply('hmmm aise hai na'), true);
    assert.equal(shouldSuppressAgentReply('Virtus ka price kya hai?'), false);
    assert.equal(shouldSuppressAgentReply('delivery wait time kitna hota hai'), false);
    assert.equal(shouldSuppressAgentReply('dekh raha hoon'), true);
    assert.equal(shouldSuppressAgentReply('SUV dekh raha tha'), false);
    assert.equal(shouldSuppressAgentReply('SUV dekh raha tha Mein'), false);
  });

  it('suppresses short backchannel acks that barge mid-speech', () => {
    assert.equal(shouldSuppressAgentReply('ठीक है'), true);
    assert.equal(shouldSuppressAgentReply('theek hai'), true);
    assert.equal(shouldSuppressAgentReply('thik hai'), true);
    assert.equal(shouldSuppressAgentReply('yes'), true);
    assert.equal(shouldSuppressAgentReply('yeah'), true);
    assert.equal(shouldSuppressAgentReply('sahi hai'), true);
    assert.equal(shouldSuppressAgentReply('bilkul'), true);
    assert.equal(shouldSuppressAgentReply('haan ji'), true);
    assert.equal(shouldSuppressAgentReply('हाँ'), true);
    assert.equal(shouldSuppressAgentReply('हाँ।'), true);
    assert.equal(shouldSuppressAgentReply('जी'), true);
    assert.equal(shouldSuppressAgentReply("ma'am"), true);
  });

  it('does not suppress go-ahead or polite thank-you', () => {
    assert.equal(shouldSuppressAgentReply('boliye'), false);
    assert.equal(shouldSuppressAgentReply('बोलिए'), false);
    assert.equal(shouldSuppressAgentReply('Thank you'), false);
    assert.equal(shouldSuppressAgentReply('धन्यवाद'), false);
    assert.equal(shouldSuppressAgentReply('और बताइए मेरे?'), false);
    assert.equal(shouldSuppressAgentReply('aur bataiye'), false);
  });
});

describe('isTellMeMoreTurn', () => {
  it('detects tell-me-more asks', () => {
    assert.equal(isTellMeMoreTurn('aur bataiye'), true);
    assert.equal(isTellMeMoreTurn('और बताइए मेरे?'), true);
    assert.equal(isTellMeMoreTurn('tell me more'), true);
    assert.equal(isTellMeMoreTurn('price kya hai'), false);
  });

  it('tell-me-more note forbids price recap', () => {
    const note = buildTellMeMoreSystemNote();
    assert.match(note, /Do NOT repeat prices/);
    assert.match(note, /Product Knowledge/);
  });
});

describe('isGoAheadCue', () => {
  it('detects Latin and Devanagari go-ahead', () => {
    assert.equal(isGoAheadCue('boliye'), true);
    assert.equal(isGoAheadCue('bolo'), true);
    assert.equal(isGoAheadCue('बोलिए'), true);
    assert.equal(isGoAheadCue('जी बोलिए'), true);
    assert.equal(isGoAheadCue('go ahead'), true);
    assert.equal(isGoAheadCue('please continue'), true);
    assert.equal(isGoAheadCue('Haan Ji bolie.'), true);
    assert.equal(isGoAheadCue('haan ji boliye'), true);
    assert.equal(isGoAheadCue('haan boliye'), true);
    assert.equal(isGoAheadCue('Haan Ji Bolie, may I please?'), true);
  });

  it('detects bataiye / tell me permission grants', () => {
    assert.equal(isGoAheadCue('haan bataiye'), true);
    assert.equal(isGoAheadCue('हाँ बताइए माम्'), true);
    assert.equal(isGoAheadCue('haan bataiye mam'), true);
    assert.equal(isGoAheadCue('yes tell me'), true);
    assert.equal(isGoAheadCue('tell me'), true);
    assert.equal(isGoAheadCue('बताइए'), true);
    assert.equal(isGoAheadCue('हाँ, बताइए माम्'), true);
  });

  it('treats bare yes / haan / Yes Sir as permission grants, not speak-go-ahead', () => {
    assert.equal(isGoAheadCue('Yes, Sir.'), false);
    assert.equal(isGoAheadCue('yes'), false);
    assert.equal(isGoAheadCue('haan'), false);
    assert.equal(isPermissionGrantCue('Yes, Sir.'), true);
    assert.equal(isPermissionGrantCue('Yes Sir'), true);
    assert.equal(isPermissionGrantCue('yes'), true);
    assert.equal(isPermissionGrantCue('sure'), true);
    assert.equal(isPermissionGrantCue('haan'), true);
    assert.equal(isPermissionGrantCue('haan ji'), true);
    assert.equal(isPermissionGrantCue('हाँ'), true);
    assert.equal(isPermissionGrantCue('हाँ जी'), true);
    assert.equal(isPermissionGrantCue('yes maam'), true);
    assert.equal(isPermissionGrantCue('haan boliye'), true);
  });

  it('rejects product questions and long turns', () => {
    assert.equal(isGoAheadCue('Taigun ki EMI batao'), false);
    assert.equal(isGoAheadCue('aur bataiye'), false);
    assert.equal(isGoAheadCue('theek hai'), false);
    assert.equal(isGoAheadCue('Thank you'), false);
    assert.equal(isPermissionGrantCue('Taigun ki EMI batao'), false);
    assert.equal(isPermissionGrantCue('aur bataiye'), false);
  });

  it('detects permission grant inside snowballed STT after permission ask', () => {
    const opener =
      'Good morning, Volkswagen se Neha bol rahi hoon. Kya main aapse thodi der baat kar sakti hoon?';
    assert.equal(
      isPermissionGrantedTurn('haan milega but call kahan se kar rahe ho', opener),
      true,
    );
    assert.equal(
      isPermissionGrantedTurn('हाँ मिलेगा call kahan se', opener),
      true,
    );
    assert.equal(
      isPermissionGrantedTurn('nahi chahiye thank you', opener),
      false,
    );
    assert.equal(
      isPermissionGrantedTurn('haan milega but call kahan se', 'Virtus ka price das lakh hai.'),
      false,
    );
  });

  it('go-ahead after a complete opener asks one question, not a catalog', () => {
    const note = buildGoAheadDiscoverySystemNote();
    assert.match(note, /ONE short discovery question/);
    assert.match(note, /Do NOT dump models/);
    assert.match(note, /Do NOT restate the enquiry/);
    assert.match(note, /already introduced/);
  });
});

describe('looksLikePermissionAsk', () => {
  it('detects outbound permission openers', () => {
    assert.equal(
      looksLikePermissionAsk(
        'Good morning, Volkswagen India se Neha bol rahi hoon. Do minute milenge?',
      ),
      true,
    );
    assert.equal(
      looksLikePermissionAsk(
        'Good afternoon, Moustache Escapes se Kavya. Kya main aapse thodi der baat kar sakti hoon?',
      ),
      true,
    );
    assert.equal(looksLikePermissionAsk('Aap sedan dekh rahe hain ya SUV?'), false);
  });
});

describe('isPoliteEndCue', () => {
  it('detects thank-you closings', () => {
    assert.equal(isPoliteEndCue('Thank you'), true);
    assert.equal(isPoliteEndCue('thanks'), true);
    assert.equal(isPoliteEndCue('धन्यवाद'), true);
    assert.equal(isPoliteEndCue('shukriya'), true);
    assert.equal(isPoliteEndCue('dhanyavaad'), true);
    assert.equal(isPoliteEndCue('bye'), true);
    assert.equal(isPoliteEndCue('alvida'), true);
  });

  it('rejects non-closing turns', () => {
    assert.equal(isPoliteEndCue('thank you, Taigun ka price batao'), false);
    assert.equal(isPoliteEndCue('boliye'), false);
  });
});

describe('looksTruncatedAssistantTurn', () => {
  it('detects barge-in remnants like Perfect, phir / Aapko', () => {
    assert.equal(looksTruncatedAssistantTurn('Perfect, phir'), true);
    assert.equal(looksTruncatedAssistantTurn('Aapko'), true);
    assert.equal(looksTruncatedAssistantTurn('City aur highway dono mein, toh'), true);
    assert.equal(looksTruncatedAssistantTurn('Taigun ek strong option hai,'), true);
  });

  it('does not flag complete sentences', () => {
    assert.equal(
      looksTruncatedAssistantTurn('Aapke budget mein Taigun ka entry fit ho sakta hai.'),
      false,
    );
    assert.equal(looksTruncatedAssistantTurn('Aap city use zyada karenge ya highway bhi?'), false);
  });
});

describe('looksIncompleteUserTurn', () => {
  it('treats clipped kya/how/what as incomplete even though they look like questions', () => {
    assert.equal(isDirectQuestionToAgent('kya'), true);
    assert.equal(looksIncompleteUserTurn('kya'), true);
    assert.equal(looksIncompleteUserTurn('how'), true);
    assert.equal(looksIncompleteUserTurn('what'), true);
    assert.equal(looksIncompleteUserTurn('kitna'), true);
  });

  it('treats hanging Hinglish connectors as incomplete', () => {
    assert.equal(looksIncompleteUserTurn('Taigun ka toh'), true);
    assert.equal(looksIncompleteUserTurn('Mujhe Taigun ka'), true);
    assert.equal(looksIncompleteUserTurn('matlab'), true);
    assert.equal(looksIncompleteUserTurn('price kya hai,'), true);
  });

  it('does not flag finished asks or short complete turns', () => {
    assert.equal(looksIncompleteUserTurn('Virtus ka price kya hai?'), false);
    assert.equal(looksIncompleteUserTurn('price kya hai'), false);
    assert.equal(looksIncompleteUserTurn('hello'), false);
    assert.equal(looksIncompleteUserTurn('price'), false);
    assert.equal(looksIncompleteUserTurn('boliye'), false);
  });

  it('treats Hindi fragment punctuation as still incomplete', () => {
    assert.equal(looksIncompleteUserTurn('हैलो, मैंने।'), true);
    assert.equal(looksIncompleteUserTurn('मैं तो'), true);
    assert.equal(looksIncompleteUserTurn('kya chahte ho ki मैं।'), true);
  });
});

describe('userTurnCommitDelayMs', () => {
  it('waits longer for incomplete fragments than complete questions', () => {
    assert.equal(userTurnCommitDelayMs('kya'), USER_TURN_INCOMPLETE_DELAY_MS);
    assert.equal(userTurnCommitDelayMs('Taigun ka toh'), USER_TURN_INCOMPLETE_DELAY_MS);
    assert.equal(userTurnCommitDelayMs('Virtus ka price kya hai?'), USER_TURN_COMPLETE_DELAY_MS);
    assert.ok(userTurnCommitDelayMs('hello') >= USER_TURN_COMPLETE_DELAY_MS);
  });
});

describe('shouldCommitUserTurn', () => {
  it('does not commit a hanging toh after 500ms', () => {
    assert.equal(
      shouldCommitUserTurn({
        text: 'Taigun ka toh',
        now: 500,
        lastSttAt: 0,
        lastVoicedAt: 0,
      }),
      false,
    );
  });

  it('commits a complete question after the short delay', () => {
    assert.equal(
      shouldCommitUserTurn({
        text: 'Virtus ka price kya hai?',
        now: USER_TURN_COMPLETE_DELAY_MS,
        lastSttAt: 0,
        lastVoicedAt: 0,
      }),
      true,
    );
  });

  it('commits at the cap even if the fragment looks incomplete', () => {
    assert.equal(
      shouldCommitUserTurn({
        text: 'Taigun ka toh',
        now: USER_TURN_COMMIT_CAP_MS,
        lastSttAt: 0,
        lastVoicedAt: 0,
      }),
      true,
    );
  });

  it('does not wait on line energy after STT is already quiet', () => {
    assert.equal(
      shouldCommitUserTurn({
        text: 'Virtus ka price kya hai?',
        now: USER_TURN_COMPLETE_DELAY_MS,
        lastSttAt: 0,
        lastVoicedAt: USER_TURN_COMPLETE_DELAY_MS,
      }),
      true,
    );
  });
});

describe('continue / polite-end system notes', () => {
  it('continue note references the truncated snippet', () => {
    const note = buildContinueInterruptedSystemNote('Perfect, phir');
    assert.match(note, /\[SYSTEM:/);
    assert.match(note, /Perfect, phir/);
    assert.match(note, /Seamlessly finish/i);
  });

  it('polite end note asks for wrap-up then end_call', () => {
    const note = buildPoliteEndSystemNote();
    assert.match(note, /\[SYSTEM:/);
    assert.match(note, /Wrap up/i);
    assert.match(note, /end_call/);
    assert.match(note, /NO booking was saved/i);
    const saved = buildPoliteEndSystemNote(true);
    assert.match(saved, /WAS saved/i);
  });

  it('refusal close forbids inventing a slot', () => {
    assert.equal(isClearRefusalTurn('ठीक है, माम् फिर मुझे नहीं चाहिए माम्, थैंक यू।'), true);
    assert.equal(
      isClearRefusalTurn('mujhe nahi chahiye thodi der baad phone karo'),
      false,
    );
    assert.equal(isClearRefusalTurn('SUV chahiye'), false);
    const note = buildRefusalCloseSystemNote(false);
    assert.match(note, /NOT a booking/i);
    assert.match(note, /NEVER invent/i);
  });

  it('availability timeline is not a price recap', () => {
    assert.equal(isAvailabilityTimelineTurn('माम्, उसके अपडेट कितनी होगी।'), true);
    assert.equal(isAvailabilityTimelineTurn('delivery kab milega'), true);
    assert.equal(isAvailabilityTimelineTurn('price kya hai'), false);
    assert.match(buildAvailabilityTimelineSystemNote(), /Do NOT recap prices/i);
  });

  it('interrupted new-question note forbids resuming the previous list', () => {
    const note = buildInterruptedNewQuestionNote();
    assert.match(note, /interrupted/i);
    assert.match(note, /do not finish/i);
    assert.doesNotMatch(note, /taigun|tsi|cockpit/i);
  });
});

describe('shouldBargeInOnSpeech', () => {
  it('cuts on 1-word product asks and stop cues', () => {
    assert.equal(shouldBargeInOnSpeech('price'), true);
    assert.equal(shouldBargeInOnSpeech('कीमत'), true);
    assert.equal(shouldBargeInOnSpeech('features'), true);
    assert.equal(shouldBargeInOnSpeech('ruko'), true);
    assert.equal(shouldBargeInOnSpeech('stop'), true);
  });

  it('does not cut on short acks', () => {
    assert.equal(shouldBargeInOnSpeech('ok'), false);
    assert.equal(shouldBargeInOnSpeech('theek hai'), false);
    assert.equal(shouldBargeInOnSpeech('haan'), false);
    assert.equal(shouldBargeInOnSpeech('yes'), false);
    assert.equal(shouldBargeInOnSpeech('हाँ'), false);
    assert.equal(shouldBargeInOnSpeech("ma'am ma'am"), false);
    assert.equal(shouldBargeInOnSpeech('जी'), false);
  });

  it('does not cut on short mid-answer speech — hold until TTS finishes', () => {
    assert.equal(shouldBargeInOnSpeech('माम् मेरे को जानना है'), false);
    assert.equal(shouldBargeInOnSpeech('आटोमेटिक पहनने का मतलब है'), false);
    assert.equal(shouldBargeInOnSpeech('Automatic. Automatic.'), false);
  });

  it('cuts on interruption and language correction cues', () => {
    assert.equal(shouldBargeInOnSpeech('arey mujhe hindi mein batao'), true);
    assert.equal(shouldBargeInOnSpeech('suniye ek minute'), true);
    assert.equal(shouldBargeInOnSpeech('अरे मुझे हिंदी में बताओ'), true);
    assert.equal(shouldBargeInOnSpeech('mujhe dono ka comparison batao pehle'), true);
  });
});

describe('isUrgentBargeInCue', () => {
  it('cuts immediately on product asks, stop cues, and questions', () => {
    assert.equal(isUrgentBargeInCue('price'), true);
    assert.equal(isUrgentBargeInCue('कीमत'), true);
    assert.equal(isUrgentBargeInCue('ruko'), true);
    assert.equal(isUrgentBargeInCue('रुको'), true);
    assert.equal(isUrgentBargeInCue('price?'), true);
    assert.equal(isUrgentBargeInCue('kitna hai?'), true);
  });

  it('does not cut on short acks', () => {
    assert.equal(isUrgentBargeInCue('ok'), false);
    assert.equal(isUrgentBargeInCue('haan'), false);
    assert.equal(isUrgentBargeInCue('theek hai'), false);
  });
});
