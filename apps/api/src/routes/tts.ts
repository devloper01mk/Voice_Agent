import { Router } from 'express';
import { z } from 'zod';
import { detectTtsLanguage, parseVoiceLanguages, rewriteRahiForSpeech } from '@vsa/shared';
import {
  CARTESIA_EMOTIONS,
  CARTESIA_LANGUAGES,
  CARTESIA_SAMPLE_RATE_IDS,
  CARTESIA_SAMPLE_RATES,
  CARTESIA_TTS_MODELS,
  DEFAULT_CARTESIA_TTS_MODEL,
  fetchIndianFemaleVoices,
  isValidCartesiaSampleRate,
  normalizeCartesiaEmotion,
} from '../cartesia.js';

export const ttsRouter = Router();

const sampleRateSchema = z
  .number()
  .int()
  .refine((n) => isValidCartesiaSampleRate(n), {
    message: `sampleRate must be one of: ${CARTESIA_SAMPLE_RATE_IDS.join(', ')}`,
  });

ttsRouter.get('/models', (_req, res) => {
  res.json(CARTESIA_TTS_MODELS);
});

ttsRouter.get('/sample-rates', (_req, res) => {
  res.json(CARTESIA_SAMPLE_RATES);
});

ttsRouter.get('/emotions', (_req, res) => {
  res.json(CARTESIA_EMOTIONS);
});

ttsRouter.get('/languages', (_req, res) => {
  res.json(CARTESIA_LANGUAGES);
});

ttsRouter.get('/voices', async (_req, res) => {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'CARTESIA_API_KEY not set' });

  try {
    const voices = await fetchIndianFemaleVoices(apiKey);
    res.json(voices);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load voices';
    res.status(502).json({ error: message });
  }
});

ttsRouter.post('/preview', async (req, res) => {
  const schema = z.object({
    text: z.string().min(1).max(500),
    voiceId: z.string(),
    speed: z.number().min(0.6).max(1.5).optional(),
    pitch: z.number().min(0.5).max(2).optional(),
    language: z.string().min(2).max(10).optional(),
    voiceLanguages: z.string().max(50).optional(),
    modelId: z.string().optional(),
    sampleRate: sampleRateSchema.optional(),
    emotion: z.string().max(40).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'CARTESIA_API_KEY not set' });

  const modelId =
    parsed.data.modelId ?? process.env.CARTESIA_MODEL_ID ?? DEFAULT_CARTESIA_TTS_MODEL;
  const speed = parsed.data.speed ?? 1.0;
  const pitch = parsed.data.pitch ?? 1.0;
  const sampleRate = parsed.data.sampleRate ?? 44100;
  const emotion = normalizeCartesiaEmotion(parsed.data.emotion);
  const languages = parseVoiceLanguages(parsed.data.voiceLanguages);
  const language =
    parsed.data.language ??
    detectTtsLanguage(parsed.data.text, languages);

  const generationConfig: Record<string, unknown> = {
    speed,
    volume: pitch,
  };
  if (emotion) generationConfig.emotion = emotion;

  const response = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Cartesia-Version': '2024-06-10',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model_id: modelId,
      transcript: rewriteRahiForSpeech(parsed.data.text),
      language,
      voice: {
        mode: 'id',
        id: parsed.data.voiceId || process.env.CARTESIA_VOICE_ID,
      },
      output_format: {
        container: 'wav',
        encoding: 'pcm_f32le',
        sample_rate: sampleRate,
      },
      generation_config: generationConfig,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return res.status(502).json({ error: 'Cartesia TTS failed', detail: err });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  res.setHeader('Content-Type', 'audio/wav');
  res.send(buffer);
});
