import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePreferredTime, istWallToUtcDate } from './schedule-parse.ts';
import {
  paintDaySlots,
  isSlotAvailable,
  isWithinOpenHours,
  DEFAULT_AVAILABILITY,
} from './availability.ts';

describe('parsePreferredTime', () => {
  const now = new Date('2026-08-03T04:30:00.000Z'); // 10:00 IST Aug 3

  it('parses kal with time', () => {
    const parsed = parsePreferredTime('kal 3 baje', { now, bookingType: 'demo' });
    assert.ok(parsed);
    assert.equal(parsed!.approximate, false);
    // Aug 4 15:00 IST
    const expected = istWallToUtcDate(2026, 8, 4, 15, 0);
    assert.equal(parsed!.scheduledStart.getTime(), expected.getTime());
  });

  it('parses ISO date with am/pm', () => {
    const parsed = parsePreferredTime('12 August 2026 11 AM', { now });
    assert.ok(parsed);
    assert.equal(parsed!.scheduledStart.getTime(), istWallToUtcDate(2026, 8, 12, 11, 0).getTime());
  });

  it('defaults subah to 10 AM not earlier', () => {
    const parsed = parsePreferredTime('kal subah', { now });
    assert.ok(parsed);
    assert.equal(parsed!.scheduledStart.getTime(), istWallToUtcDate(2026, 8, 4, 10, 0).getTime());
  });

  it('resolves next to next week Tuesday on Tue 22 Sep 2026 to 6 Oct', () => {
    const tue = new Date('2026-09-22T04:30:00.000Z'); // 10:00 IST Tue 22 Sep
    const parsed = parsePreferredTime('next to next week Tuesday', { now: tue });
    assert.ok(parsed);
    assert.equal(parsed!.scheduledStart.getTime(), istWallToUtcDate(2026, 10, 6, 11, 0).getTime());
  });

  it('resolves next week Tuesday on Tue 22 Sep 2026 to 29 Sep', () => {
    const tue = new Date('2026-09-22T04:30:00.000Z');
    const parsed = parsePreferredTime('next week Tuesday', { now: tue });
    assert.ok(parsed);
    assert.equal(parsed!.scheduledStart.getTime(), istWallToUtcDate(2026, 9, 29, 11, 0).getTime());
  });

  it('resolves agle agle hafte mangalvaar like next to next Tuesday', () => {
    const tue = new Date('2026-09-22T04:30:00.000Z');
    const parsed = parsePreferredTime('agle agle hafte mangalvaar', { now: tue });
    assert.ok(parsed);
    assert.equal(parsed!.scheduledStart.getTime(), istWallToUtcDate(2026, 10, 6, 11, 0).getTime());
  });

  it('bare Tuesday on a Tuesday still jumps +7 days', () => {
    const tue = new Date('2026-09-22T04:30:00.000Z');
    const parsed = parsePreferredTime('Tuesday', { now: tue });
    assert.ok(parsed);
    assert.equal(parsed!.scheduledStart.getTime(), istWallToUtcDate(2026, 9, 29, 11, 0).getTime());
  });
});

describe('availability paint', () => {
  // Use a weekday far enough in the future so "alternatives" are not filtered by Date.now().
  const future = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 21);
    // Nudge to a Tuesday in IST-ish wall date
    while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    return { y, m, day, iso: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
  })();

  it('marks overlapping slot full', () => {
    const start = istWallToUtcDate(future.y, future.m, future.day, 10, 0);
    const end = istWallToUtcDate(future.y, future.m, future.day, 10, 30);
    const slots = paintDaySlots(DEFAULT_AVAILABILITY, future.iso, [
      { id: '1', scheduledStart: start, scheduledEnd: end, name: 'Rahul', status: 'new' },
    ]);
    const first = slots[0]!;
    assert.equal(first.status, 'full');
    assert.equal(first.remainingCapacity, 0);
  });

  it('rejects when capacity reached', () => {
    const start = istWallToUtcDate(future.y, future.m, future.day, 10, 0);
    const end = istWallToUtcDate(future.y, future.m, future.day, 10, 30);
    const result = isSlotAvailable(DEFAULT_AVAILABILITY, start, end, [
      { id: '1', scheduledStart: start, scheduledEnd: end, status: 'confirmed' },
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.alternatives.length >= 1);
  });

  it('rejects before 10:00 AM', () => {
    const start = istWallToUtcDate(future.y, future.m, future.day, 8, 0);
    const end = istWallToUtcDate(future.y, future.m, future.day, 8, 30);
    assert.equal(isWithinOpenHours(DEFAULT_AVAILABILITY, start, end), false);
    const result = isSlotAvailable(DEFAULT_AVAILABILITY, start, end, []);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /outside booking hours/i);
      assert.ok(result.alternatives.length >= 1);
      assert.ok(
        result.alternatives[0]!.start.getTime() >=
          istWallToUtcDate(future.y, future.m, future.day, 10, 0).getTime(),
      );
    }
  });

  it('rejects at/after 7:00 PM', () => {
    const start = istWallToUtcDate(future.y, future.m, future.day, 19, 0);
    const end = istWallToUtcDate(future.y, future.m, future.day, 19, 30);
    const result = isSlotAvailable(DEFAULT_AVAILABILITY, start, end, []);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /outside booking hours/i);
  });

  it('allows 10:00 AM and 6:30 PM', () => {
    const morning = isSlotAvailable(
      DEFAULT_AVAILABILITY,
      istWallToUtcDate(future.y, future.m, future.day, 10, 0),
      istWallToUtcDate(future.y, future.m, future.day, 10, 30),
      [],
    );
    const evening = isSlotAvailable(
      DEFAULT_AVAILABILITY,
      istWallToUtcDate(future.y, future.m, future.day, 18, 30),
      istWallToUtcDate(future.y, future.m, future.day, 19, 0),
      [],
    );
    assert.equal(morning.ok, true);
    assert.equal(evening.ok, true);
  });

  it('skips open-day and hours checks when calendar is disabled', () => {
    const sunday = istWallToUtcDate(future.y, future.m, future.day, 22, 0);
    const end = istWallToUtcDate(future.y, future.m, future.day, 23, 0);
    const result = isSlotAvailable(
      { ...DEFAULT_AVAILABILITY, enabled: false },
      sunday,
      end,
      [],
    );
    assert.equal(result.ok, true);
  });
});

describe('formatBookingWindowLabel', () => {
  it('describes configured open days dynamically', async () => {
    const { formatBookingWindowLabel, formatOpenDaysLabel } = await import('./availability.ts');
    assert.equal(formatOpenDaysLabel(DEFAULT_AVAILABILITY), 'Mon–Sat');
    assert.match(formatBookingWindowLabel(DEFAULT_AVAILABILITY), /Mon–Sat/);
    assert.equal(
      formatBookingWindowLabel({ ...DEFAULT_AVAILABILITY, enabled: false }),
      'any day (calendar off)',
    );
  });
});
