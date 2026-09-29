import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callerAskedToEndCall } from './hangup-phrase.js';

describe('callerAskedToEndCall', () => {
  it('allows only the written goodbye words', () => {
    assert.equal(callerAskedToEndCall('thank you'), true);
    assert.equal(callerAskedToEndCall('Thanks, bye'), true);
    assert.equal(callerAskedToEndCall('bas'), true);
    assert.equal(callerAskedToEndCall('bas ho gaya'), true);
    assert.equal(callerAskedToEndCall('this is a wrong number'), true);
    assert.equal(callerAskedToEndCall('please do not call again'), true);
  });

  it('does not treat a payment or booking question as goodbye', () => {
    assert.equal(callerAskedToEndCall('अगर मैंने पेमेंट किया नहीं तो'), false);
    assert.equal(callerAskedToEndCall('अपने डेट तक पेमेंट कर करना होगा।'), false);
    assert.equal(callerAskedToEndCall('hotel ka naam kya hai'), false);
    assert.equal(callerAskedToEndCall('bas yeh bata do price kya hai'), false);
    assert.equal(callerAskedToEndCall(''), false);
  });
});
