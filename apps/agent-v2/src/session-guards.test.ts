import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FAKE_BOOKING_CORRECTION_LINE } from '@vsa/shared';
import { shouldCorrectFakeBooking } from './session-guards.js';

describe('shouldCorrectFakeBooking', () => {
  it('flags a spoken confirm when the lead tool has not saved', () => {
    assert.equal(shouldCorrectFakeBooking('Aapki booking confirm ho gayi hai 15 September ko.', false), true);
    assert.equal(shouldCorrectFakeBooking('Slot confirm ho gaya, aap aa jaiyega.', false), true);
    assert.equal(shouldCorrectFakeBooking('Your booking is confirmed for Wednesday.', false), true);
  });

  it('stays quiet after a real save, or when no confirm was claimed', () => {
    assert.equal(shouldCorrectFakeBooking('Aapki booking confirm ho gayi hai.', true), false);
    assert.equal(
      shouldCorrectFakeBooking('Udaipur mein hostel available hai. Kaunsa room suit karega?', false),
      false,
    );
  });

  it('ignores intake "please confirm" lines from the real call transcript', () => {
    assert.equal(
      shouldCorrectFakeBooking(
        'Is it Yadav Singh? Please confirm so I can finalize your Deluxe King room booking.',
        false,
      ),
      false,
    );
    assert.equal(
      shouldCorrectFakeBooking('Is it 7277700848? Please confirm so I can save your', false),
      false,
    );
    assert.equal(
      shouldCorrectFakeBooking('Aapka naam confirm karna hai kya main ise Yadav Singh ke roop mein save kar sakti hoon?', false),
      false,
    );
  });

  it('does not re-trigger on its own correction line (loop that wrecked the call)', () => {
    assert.equal(shouldCorrectFakeBooking(FAKE_BOOKING_CORRECTION_LINE, false), false);
    assert.equal(shouldCorrectFakeBooking('Abhi booking save pending hai —', false), false);
    assert.equal(shouldCorrectFakeBooking('Abhi booking save pending', false), false);
    assert.equal(
      shouldCorrectFakeBooking('Abhi booking save pending hai — confirm nahi hui. Jo detail missing hai wo bataiye.', false),
      false,
    );
    assert.equal(
      shouldCorrectFakeBooking('The booking is not saved yet. Tell me the one detail that is still missing.', false),
      false,
    );
  });
});
