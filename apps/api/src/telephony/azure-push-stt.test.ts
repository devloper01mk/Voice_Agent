import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AZURE_LID_BLOCK_MS,
  TELEPHONY_STT_SILENCE_MS,
  azureAutodetectFallbackMessage,
  isAzureAutodetectFallbackMessage,
  pickSingleLocale,
} from './azure-push-stt.ts';

describe('pickSingleLocale', () => {
  const both = ['en-IN', 'hi-IN'];

  it('uses hi-IN for Hindi-only agents', () => {
    assert.equal(pickSingleLocale(both, 'hi'), 'hi-IN');
  });

  it('uses en-IN for English-only agents', () => {
    assert.equal(pickSingleLocale(both, 'en'), 'en-IN');
  });

  it('keeps en-IN for mixed Hinglish (Roman Hinglish)', () => {
    assert.equal(pickSingleLocale(both, 'en,hi,hinglish'), 'en-IN');
    assert.equal(pickSingleLocale(both), 'en-IN');
  });
});

describe('Azure AutoDetect fallback', () => {
  it('ends a phrase after a short silence so the agent can answer faster', () => {
    assert.equal(TELEPHONY_STT_SILENCE_MS, 450);
  });

  it('blocks LID for 90 seconds, not 30 minutes', () => {
    assert.equal(AZURE_LID_BLOCK_MS, 90_000);
  });

  it('logs a pipeline-detectable Hindi warning', () => {
    const message = azureAutodetectFallbackMessage('en-IN', 'websocket error code: 1007');
    assert.equal(isAzureAutodetectFallbackMessage(message), true);
    assert.match(message, /Hindi may be misheard/i);
    assert.match(message, /S0/);
    assert.match(message, /90s/);
  });
});
