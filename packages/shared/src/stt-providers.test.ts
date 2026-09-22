import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_GOOGLE_STT_MODEL,
  DEFAULT_OPENAI_STT_MODEL,
  DEFAULT_SARVAM_STT_MODEL,
  DEFAULT_STT_PROVIDER,
  buildGoogleRecognizerPath,
  defaultSttModel,
  googleSttLanguageCodes,
  isGoogleSttModel,
  isOpenAiSttModel,
  isSarvamSttModel,
  normalizeSttProvider,
  openAiSttDetectLanguage,
  openAiSttLanguage,
  resolveGoogleCloudProjectId,
  resolveGoogleSpeechLocation,
  resolveSttModel,
  sarvamSttLanguageCode,
  sarvamSttMode,
} from './stt-providers.js';

describe('stt-providers', () => {
  it('defaults provider to azure', () => {
    assert.equal(DEFAULT_STT_PROVIDER, 'azure');
    assert.equal(normalizeSttProvider(undefined), 'azure');
    assert.equal(normalizeSttProvider('openai'), 'openai');
    assert.equal(normalizeSttProvider('sarvam'), 'sarvam');
    assert.equal(normalizeSttProvider('google'), 'google');
    assert.equal(normalizeSttProvider('unknown'), 'azure');
  });

  it('resolves OpenAI models and falls back to recommended default', () => {
    assert.equal(defaultSttModel('openai'), DEFAULT_OPENAI_STT_MODEL);
    assert.equal(defaultSttModel('azure'), '');
    assert.equal(defaultSttModel('sarvam'), DEFAULT_SARVAM_STT_MODEL);
    assert.equal(defaultSttModel('google'), DEFAULT_GOOGLE_STT_MODEL);
    assert.equal(resolveSttModel('openai', 'gpt-4o-transcribe'), 'gpt-4o-transcribe');
    assert.equal(resolveSttModel('openai', 'not-a-model'), DEFAULT_OPENAI_STT_MODEL);
    assert.equal(resolveSttModel('azure', 'gpt-4o-transcribe'), '');
    assert.equal(isOpenAiSttModel('whisper-1'), true);
    assert.equal(isOpenAiSttModel('gpt-5'), false);
  });

  it('resolves Sarvam models and Hinglish mode', () => {
    assert.equal(resolveSttModel('sarvam', 'saaras:v4'), 'saaras:v4');
    assert.equal(resolveSttModel('sarvam', 'bad'), DEFAULT_SARVAM_STT_MODEL);
    assert.equal(isSarvamSttModel('saaras:v3'), true);
    assert.equal(sarvamSttMode('en,hi,hinglish'), 'codemix');
    assert.equal(sarvamSttMode('en'), 'transcribe');
    assert.equal(sarvamSttLanguageCode('en,hi,hinglish'), 'unknown');
    assert.equal(sarvamSttLanguageCode('hi'), 'hi-IN');
  });

  it('resolves Google models and language codes', () => {
    assert.equal(resolveSttModel('google', 'chirp_2'), 'chirp_2');
    assert.equal(resolveSttModel('google', 'bad'), DEFAULT_GOOGLE_STT_MODEL);
    assert.equal(isGoogleSttModel('chirp_3'), true);
    assert.deepEqual(googleSttLanguageCodes('en,hi,hinglish'), ['en-IN', 'hi-IN']);
    assert.deepEqual(googleSttLanguageCodes('hi'), ['hi-IN']);
    assert.equal(resolveGoogleSpeechLocation(undefined), 'asia-south1');
    assert.equal(
      buildGoogleRecognizerPath('my-proj', 'asia-south1'),
      'projects/my-proj/locations/asia-south1/recognizers/_',
    );
    const prev = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = 'env-proj';
    assert.equal(resolveGoogleCloudProjectId(), 'env-proj');
    process.env.GOOGLE_CLOUD_PROJECT = prev;
  });

  it('maps speak languages for OpenAI STT', () => {
    assert.equal(openAiSttLanguage(['en']), 'en');
    assert.equal(openAiSttLanguage(['hi']), 'hi');
    assert.equal(openAiSttLanguage(['en', 'hi', 'hinglish']), 'en');
    assert.equal(openAiSttDetectLanguage(['en']), false);
    assert.equal(openAiSttDetectLanguage(['en', 'hi']), true);
    assert.equal(openAiSttDetectLanguage(['hinglish']), true);
  });
});
