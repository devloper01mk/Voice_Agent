import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addIstCalendarDays,
  buildCallTimeContextPrompt,
  buildRelativeDateRulesPrompt,
  buildTimeGreetingSystemNote,
  dayPartFromHour,
  getIstCalendarParts,
  getIstNowParts,
  greetingForDayPart,
  isTimeOfDayGreeting,
} from './call-time.ts';

describe('dayPartFromHour', () => {
  it('maps IST buckets (morning until noon, evening from 3 PM)', () => {
    assert.equal(dayPartFromHour(5), 'morning');
    assert.equal(dayPartFromHour(11), 'morning');
    assert.equal(dayPartFromHour(12), 'afternoon');
    assert.equal(dayPartFromHour(14), 'afternoon');
    assert.equal(dayPartFromHour(15), 'evening');
    assert.equal(dayPartFromHour(16), 'evening');
    assert.equal(dayPartFromHour(20), 'evening');
    assert.equal(dayPartFromHour(21), 'night');
    assert.equal(dayPartFromHour(0), 'night');
    assert.equal(dayPartFromHour(4), 'night');
  });
});

describe('greetingForDayPart', () => {
  it('uses Good evening for night openers', () => {
    assert.equal(greetingForDayPart('night').greetingEn, 'Good evening');
    assert.equal(greetingForDayPart('afternoon').greetingEn, 'Good afternoon');
  });
});

describe('getIstNowParts', () => {
  it('returns evening for a known UTC instant that is 4:33 PM IST', () => {
    // 16:33 IST = 11:03 UTC on 16 July 2026
    const now = new Date('2026-07-16T11:03:00.000Z');
    const p = getIstNowParts(now);
    assert.equal(p.dayPart, 'evening');
    assert.equal(p.greetingEn, 'Good evening');
    assert.match(p.clockLabel, /4 33 PM IST/);
    assert.doesNotMatch(p.clockLabel, /:/);
    assert.equal(p.isoDate, '2026-07-16');
    assert.match(p.dateLabel, /16 July 2026/);
  });

  it('returns afternoon at 1 PM IST', () => {
    // 13:00 IST = 07:30 UTC on 16 July 2026
    const now = new Date('2026-07-16T07:30:00.000Z');
    const p = getIstNowParts(now);
    assert.equal(p.dayPart, 'afternoon');
    assert.equal(p.greetingEn, 'Good afternoon');
  });
});

describe('getIstCalendarParts / addIstCalendarDays', () => {
  it('resolves aaj kal parso from 17 July 2026 IST', () => {
    // 17 July 2026 10:00 IST = 17 July 2026 04:30 UTC
    const now = new Date('2026-07-17T04:30:00.000Z');
    const cal = getIstCalendarParts(now);
    assert.equal(cal.isoDate, '2026-07-17');
    assert.equal(cal.weekday, 'Friday');

    const aaj = addIstCalendarDays(cal.year, cal.month, cal.day, 0);
    const kal = addIstCalendarDays(cal.year, cal.month, cal.day, 1);
    const parso = addIstCalendarDays(cal.year, cal.month, cal.day, 2);

    assert.equal(aaj.isoDate, '2026-07-17');
    assert.equal(kal.isoDate, '2026-07-18');
    assert.equal(parso.isoDate, '2026-07-19');
    assert.match(parso.dateLabel, /19 July 2026/);
  });
});

describe('isTimeOfDayGreeting', () => {
  it('detects English and Hindi morning greetings', () => {
    assert.equal(isTimeOfDayGreeting('Good morning'), true);
    assert.equal(isTimeOfDayGreeting('good afternoon maam'), true);
    assert.equal(isTimeOfDayGreeting('Good evening'), true);
    assert.equal(isTimeOfDayGreeting('shubh prabhat'), true);
    assert.equal(isTimeOfDayGreeting('my budget is ten lakh'), false);
  });
});

describe('buildCallTimeContextPrompt', () => {
  it('includes preferred evening greeting at 4:33 PM IST', () => {
    const now = new Date('2026-07-16T11:03:00.000Z');
    const prompt = buildCallTimeContextPrompt(now);
    assert.match(prompt, /Good evening/);
    assert.match(prompt, /do \*\*not\*\* mirror/i);
    assert.match(prompt, /16 July 2026/);
  });

  it('includes concrete aaj/kal/parso mappings and past-time rejection', () => {
    const now = new Date('2026-07-17T04:30:00.000Z');
    const prompt = buildCallTimeContextPrompt(now);
    assert.match(prompt, /aaj \/ today/i);
    assert.match(prompt, /17 July 2026/);
    assert.match(prompt, /parso \/ day after tomorrow/i);
    assert.match(prompt, /19 July 2026/);
    assert.match(prompt, /Past datetime validation/i);
    assert.match(prompt, /Always confirm/i);
  });
});

describe('buildRelativeDateRulesPrompt', () => {
  it('maps parso to day+2', () => {
    const now = new Date('2026-07-17T04:30:00.000Z');
    const rules = buildRelativeDateRulesPrompt(now);
    assert.match(rules, /parso/);
    assert.match(rules, /19 July 2026/);
  });
});

describe('buildTimeGreetingSystemNote', () => {
  it('tells LLM not to say Good morning in the evening', () => {
    const now = new Date('2026-07-16T11:03:00.000Z');
    const note = buildTimeGreetingSystemNote(now);
    assert.match(note, /evening/);
    assert.match(note, /Good evening/);
    assert.match(note, /do NOT mirror/i);
    assert.match(note, /16 July 2026/);
  });
});
