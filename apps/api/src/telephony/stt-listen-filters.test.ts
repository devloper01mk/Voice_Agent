import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isGreetingEchoTranscript,
  isShortNumberSttNoise,
  stripLeadingSttNumberNoise,
} from './stt-listen-filters.ts';

describe('isGreetingEchoTranscript', () => {
  it('keeps inbound hello when the agent has not spoken yet', () => {
    assert.equal(isGreetingEchoTranscript('hello', 0, 10_000), false);
    assert.equal(isGreetingEchoTranscript('Hi', 0, 10_000), false);
    assert.equal(isGreetingEchoTranscript('namaste', 0, 10_000), false);
  });

  it('treats hello as echo only in the window after agent TTS starts', () => {
    const speakStartedAt = 5_000;
    assert.equal(isGreetingEchoTranscript('hello', speakStartedAt, 6_000), true);
    assert.equal(isGreetingEchoTranscript('hey', speakStartedAt, 7_400), true);
    assert.equal(isGreetingEchoTranscript('hello', speakStartedAt, 7_600), false);
    assert.equal(isGreetingEchoTranscript('हैलो।', speakStartedAt, 6_000), true);
  });

  it('treats hello as echo for the whole time the agent is still playing', () => {
    const speakStartedAt = 5_000;
    assert.equal(
      isGreetingEchoTranscript('hello', speakStartedAt, 12_000, { playing: true }),
      true,
    );
    assert.equal(
      isGreetingEchoTranscript('हैलो', speakStartedAt, 12_000, { playing: true }),
      true,
    );
  });

  it('does not flag real questions as greeting echo', () => {
    assert.equal(isGreetingEchoTranscript('hello Cronberry', 5_000, 6_000), false);
    assert.equal(isGreetingEchoTranscript('kaun hai', 5_000, 6_000), false);
  });
});

describe('stripLeadingSttNumberNoise', () => {
  it('keeps go-ahead speech after Azure number fragments', () => {
    assert.equal(stripLeadingSttNumberNoise('100 140 हाँ जी बोलिए'), 'हाँ जी बोलिए');
    assert.equal(stripLeadingSttNumberNoise('100 140 haan ji boliye'), 'haan ji boliye');
  });

  it('does not strip real short numbers in speech', () => {
    assert.equal(stripLeadingSttNumberNoise('2 minute milenge'), '2 minute milenge');
    assert.equal(stripLeadingSttNumberNoise('10 lakh on road'), '10 lakh on road');
  });

  it('flags lone 3–4 digit fragments as noise', () => {
    assert.equal(isShortNumberSttNoise('100'), true);
    assert.equal(isShortNumberSttNoise('100 140'), true);
    assert.equal(isShortNumberSttNoise('हाँ जी बोलिए'), false);
  });
});
