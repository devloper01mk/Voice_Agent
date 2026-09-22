import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { AzureSTT } from './azure-stt.js';
import { createStt } from './stt-factory.js';
import type { RuntimeAgent } from './load-agent.js';

const baseAgent: RuntimeAgent = {
  id: 'agent-1',
  name: 'Maya',
  greeting: 'Hi',
  productName: 'Cronberry CRM',
  voiceId: 'voice-1',
  voiceLanguage: 'en',
  voiceLanguages: 'en,hi,hinglish',
  voiceSpeed: 1,
  voicePitch: 1,
  ttsModel: 'sonic-3.6',
  agentGender: 'female',
  llmProvider: 'gpt',
  llmModel: 'gpt-5.4-mini',
  compiledSystemPrompt: 'system',
};

describe('createStt', () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousAzureKey = process.env.AZURE_SPEECH_KEY;

  beforeEach(() => {
    process.env.AZURE_SPEECH_KEY = 'test-azure-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
  });

  afterEach(() => {
    if (previousOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
    if (previousAzureKey === undefined) {
      delete process.env.AZURE_SPEECH_KEY;
    } else {
      process.env.AZURE_SPEECH_KEY = previousAzureKey;
    }
  });

  it('defaults to Azure STT', () => {
    const stt = createStt(baseAgent);
    assert.ok(stt instanceof AzureSTT);
  });

  it('selects Azure when provider is azure', () => {
    const stt = createStt({
      ...baseAgent,
      sttProvider: 'azure',
      sttModel: '',
    });
    assert.ok(stt instanceof AzureSTT);
  });

  it('selects OpenAI streaming STT with resolved model', () => {
    const stt = createStt({
      ...baseAgent,
      sttProvider: 'openai',
      sttModel: 'gpt-4o-transcribe',
    });
    assert.equal(stt.label, 'openai.STT');
    assert.equal(stt.model, 'gpt-4o-transcribe');
  });

  it('falls back to default OpenAI model when missing/invalid', () => {
    const stt = createStt({
      ...baseAgent,
      sttProvider: 'openai',
      sttModel: 'not-real',
    });
    assert.equal(stt.label, 'openai.STT');
    assert.equal(stt.model, 'gpt-4o-mini-transcribe');
  });

  it('throws when OpenAI STT is selected without API key', () => {
    delete process.env.OPENAI_API_KEY;
    assert.throws(
      () =>
        createStt({
          ...baseAgent,
          sttProvider: 'openai',
          sttModel: 'gpt-4o-mini-transcribe',
        }),
      /OpenAI API key is required/,
    );
  });
});
