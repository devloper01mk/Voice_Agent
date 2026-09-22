import type { stt as SttModule } from '@livekit/agents';
import type { VAD } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as sarvam from '@livekit/agents-plugin-sarvam';
import {
  normalizeSttProvider,
  openAiSttDetectLanguage,
  openAiSttLanguage,
  parseVoiceLanguages,
  resolveSttModel,
  sarvamSttLanguageCode,
  sarvamSttMode,
  type SpeakLanguage,
} from '@vsa/shared';
import { GoogleSTT } from './google-stt.js';
import { AzureSTT } from './azure-stt.js';
import { getLatencyConfig } from './latency-profile.js';
import type { RuntimeAgent } from './load-agent.js';
import { buildSttPhraseList } from './stt-phrase-list.js';

export interface CreateSttOptions {
  languages?: SpeakLanguage[];
  sampleRate?: number;
  onError?: (message: string) => void;
  /** Required for OpenAI `gpt-realtime-whisper` streaming commits. */
  vad?: VAD;
}

export function createStt(agent: RuntimeAgent, options: CreateSttOptions = {}): SttModule.STT {
  const provider = normalizeSttProvider(agent.sttProvider);
  const languages =
    options.languages ?? parseVoiceLanguages(agent.voiceLanguages);
  const latency = getLatencyConfig();

  if (provider === 'openai') {
    const model = resolveSttModel('openai', agent.sttModel);
    return new openai.STT({
      apiKey: process.env.OPENAI_API_KEY,
      model,
      useRealtime: true,
      language: openAiSttLanguage(languages),
      detectLanguage: openAiSttDetectLanguage(languages),
      vad: options.vad,
    });
  }

  if (provider === 'sarvam') {
    const model = resolveSttModel('sarvam', agent.sttModel);
    const voiceLangs = agent.voiceLanguages ?? languages.join(',');
    return new sarvam.STT({
      apiKey: process.env.SARVAM_API_KEY,
      model: model as 'saaras:v3',
      mode: sarvamSttMode(voiceLangs),
      languageCode: sarvamSttLanguageCode(voiceLangs),
      highVadSensitivity: true,
      streaming: true,
    });
  }

  if (provider === 'google') {
    return new GoogleSTT({
      model: resolveSttModel('google', agent.sttModel),
      languages,
      sampleRate: options.sampleRate ?? 16000,
      onError: options.onError,
    });
  }

  return new AzureSTT({
    languages,
    sampleRate: options.sampleRate ?? 16000,
    ...latency.azureStt,
    phraseList: buildSttPhraseList(agent.productName, agent.skillsConfig),
    onError: options.onError,
  });
}
