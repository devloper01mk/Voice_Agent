import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isFastOpenerEnabled, resolveScriptedOpener, shouldWaitForAmdBeforeOpener } from './telephony-opener.js';
import { resolveAmdTimeoutMs } from './voicemail-detection.js';

describe('telephony-opener', () => {
  it('uses greeting with prospect name by default', () => {
    const text = resolveScriptedOpener(
      {
        name: 'Maya',
        productName: 'Cronberry CRM',
        greeting: 'Hi, main Maya bol rehi hoon Cronberry CRM se.',
      } as Parameters<typeof resolveScriptedOpener>[0],
      'Rahul',
    );
    assert.match(text, /Rahul/);
    assert.match(text, /Cronberry CRM/);
  });

  it('fast opener enabled unless explicitly disabled', () => {
    const prev = process.env.TELEPHONY_FAST_OPENER;
    delete process.env.TELEPHONY_FAST_OPENER;
    assert.equal(isFastOpenerEnabled(), true);
    process.env.TELEPHONY_FAST_OPENER = '0';
    assert.equal(isFastOpenerEnabled(), false);
    if (prev === undefined) delete process.env.TELEPHONY_FAST_OPENER;
    else process.env.TELEPHONY_FAST_OPENER = prev;
  });

  it('skips AMD wait before scripted opener by default', () => {
    const prevFast = process.env.TELEPHONY_FAST_OPENER;
    const prevAmd = process.env.TELEPHONY_AMD_BEFORE_OPENER;
    delete process.env.TELEPHONY_FAST_OPENER;
    delete process.env.TELEPHONY_AMD_BEFORE_OPENER;
    assert.equal(
      shouldWaitForAmdBeforeOpener({ greeting: 'Hi, welcome!' } as Parameters<typeof shouldWaitForAmdBeforeOpener>[0]),
      false,
    );
    process.env.TELEPHONY_AMD_BEFORE_OPENER = '1';
    assert.equal(
      shouldWaitForAmdBeforeOpener({ greeting: 'Hi, welcome!' } as Parameters<typeof shouldWaitForAmdBeforeOpener>[0]),
      true,
    );
    if (prevFast === undefined) delete process.env.TELEPHONY_FAST_OPENER;
    else process.env.TELEPHONY_FAST_OPENER = prevFast;
    if (prevAmd === undefined) delete process.env.TELEPHONY_AMD_BEFORE_OPENER;
    else process.env.TELEPHONY_AMD_BEFORE_OPENER = prevAmd;
  });
});

describe('resolveAmdTimeoutMs', () => {
  it('defaults to 1800ms', () => {
    const prev = process.env.TELEPHONY_AMD_TIMEOUT_MS;
    delete process.env.TELEPHONY_AMD_TIMEOUT_MS;
    assert.equal(resolveAmdTimeoutMs(), 1800);
    if (prev === undefined) delete process.env.TELEPHONY_AMD_TIMEOUT_MS;
    else process.env.TELEPHONY_AMD_TIMEOUT_MS = prev;
  });
});
