import * as cartesia from '@livekit/agents-plugin-cartesia';
import {
  type SpeakLanguage,
  defaultTtsLanguage,
  detectTtsLanguage,
  lockSpokenHinglishGender,
  parseVoiceLanguages,
  prepareEnglishLockSpeech,
  rewriteClockTimesForSpeech,
} from '@vsa/shared';

export type MultilingualTtsHandle = cartesia.TTS & {
  setCallLanguageLock: (locale: 'en' | 'hi' | null) => void;
};

function speechLangFromTtsLocale(locale: string): 'en' | 'hinglish' {
  const l = locale.toLowerCase();
  if (l === 'hi' || l.startsWith('hi-') || l === 'hindi') return 'hinglish';
  return 'en';
}

function normalizeEmotion(raw?: string): string[] | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === 'neutral') return undefined;
  return [trimmed];
}

export function createMultilingualCartesiaTts(
  opts: {
    apiKey: string;
    voiceId: string;
    voiceLanguages: string;
    speed: number;
    pitch: number;
    model?: string;
    sampleRate?: number;
    emotion?: string;
    agentGender?: string;
  },
): MultilingualTtsHandle {
  const enabled = parseVoiceLanguages(opts.voiceLanguages);
  const emotion = normalizeEmotion(opts.emotion);
  const tts = new MultilingualCartesiaTTS({
    apiKey: opts.apiKey,
    model: opts.model ?? process.env.CARTESIA_MODEL_ID ?? 'sonic-3.6',
    voice: opts.voiceId || process.env.CARTESIA_VOICE_ID,
    language: defaultTtsLanguage(enabled),
    speed: opts.speed,
    volume: Math.min(2, Math.max(0.5, opts.pitch)),
    sampleRate: opts.sampleRate ?? 24000,
    ...(emotion ? { emotion } : {}),
    // LLM token gaps can exceed the default 5s; closing the WS drops the rest of the reply.
    chunkTimeout: 20_000,
    enabledLanguages: enabled,
    agentGender: opts.agentGender,
  });
  return tts;
}

class MultilingualCartesiaTTS extends cartesia.TTS {
  #enabledLanguages: SpeakLanguage[];
  #agentGender?: string;
  /**
   * Call speech lock from user-turn handler.
   * 'en' = English lock/soft-en (stable English voice + numbers).
   * 'hi' = Hinglish/Hindi.
   * null = detect from text.
   */
  #callLanguageLock: 'en' | 'hi' | null = null;

  constructor(
    opts: Partial<cartesia.TTSOptions> & {
      enabledLanguages: SpeakLanguage[];
      agentGender?: string;
    },
  ) {
    const { enabledLanguages, agentGender, ...ttsOpts } = opts;
    super(ttsOpts);
    this.#enabledLanguages = enabledLanguages;
    this.#agentGender = agentGender;
  }

  setCallLanguageLock(locale: 'en' | 'hi' | null) {
    this.#callLanguageLock = locale;
    // Apply immediately so a prior hi stream option cannot stick after English lock.
    if (locale === 'en' || locale === 'hi') {
      this.updateOptions({ language: locale });
    }
  }

  /** English lock always wins — never fall back to detectTtsLanguage → hi. */
  #resolveLanguage(text: string): string {
    if (this.#callLanguageLock === 'en') return 'en';
    if (this.#callLanguageLock === 'hi') return 'hi';
    return detectTtsLanguage(text, this.#enabledLanguages);
  }

  #rewriteForSpeech(text: string): string {
    const gendered = lockSpokenHinglishGender(text, this.#agentGender);
    // English lock: English clocks + strip Hindi quantity slips (das → ten).
    if (this.#callLanguageLock === 'en') {
      return prepareEnglishLockSpeech(gendered);
    }
    const locale = this.#resolveLanguage(gendered);
    return rewriteClockTimesForSpeech(gendered, speechLangFromTtsLocale(locale));
  }

  synthesize(
    text: string,
    connOptions?: Parameters<cartesia.TTS['synthesize']>[1],
    abortSignal?: AbortSignal,
  ) {
    const rewritten = this.#rewriteForSpeech(text);
    const language = this.#resolveLanguage(rewritten);
    this.updateOptions({ language });
    return super.synthesize(rewritten, connOptions, abortSignal);
  }

  stream(options?: Parameters<cartesia.TTS['stream']>[0]) {
    const stream = super.stream(options);
    let buffer = '';
    let languageLocked = false;
    const resolve = (text: string) => this.#resolveLanguage(text);
    const rewrite = (text: string) => this.#rewriteForSpeech(text);

    const origPush = stream.pushText.bind(stream);
    stream.pushText = (text: string) => {
      buffer += text;
      // Under English lock, force en on first audio so voice does not flip mid-utterance.
      if (this.#callLanguageLock === 'en' && !languageLocked) {
        stream.updateOptions({ language: 'en' });
        languageLocked = true;
      }
      origPush(rewrite(text));
    };

    const origFlush = stream.flush.bind(stream);
    stream.flush = () => {
      if (!languageLocked && buffer.trim()) {
        stream.updateOptions({
          language: resolve(buffer),
        });
        languageLocked = true;
      }
      buffer = '';
      origFlush();
    };

    return stream;
  }
}
