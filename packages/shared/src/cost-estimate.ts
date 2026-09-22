import type { LlmProvider } from './index.js';

/** Approximate FX for display — estimates only. */
export const USD_TO_INR = 85;

/** Published per-use rates (USD) — see vendor pricing pages; estimates only. */
export const PUBLISHED_PRICING_USD = {
  /** Azure Speech — standard real-time STT, ~$1.00 / audio hour */
  azureSttPerAudioHour: 1.0,
  /** Cartesia Sonic — ~$50 / 1M characters (pay-as-you-go tier) */
  cartesiaPerMillionCharacters: 50,
  groq: {
    inputPerMillionTokens: 0.59,
    outputPerMillionTokens: 0.79,
  },
  gpt: {
    /** gpt-5.4-mini — phone / Simulator 2.0 default */
    inputPerMillionTokens: 0.75,
    outputPerMillionTokens: 4.5,
    /** OpenAI prompt-cache hit rate vs full input (10% of input). */
    cachedInputPerMillionTokens: 0.075,
  },
  /** Gemini Live native-audio (Flash) — token-based; audio is billed separately from text. */
  geminiLive: {
    inputTextPerMillionTokens: 0.5,
    outputTextPerMillionTokens: 2.0,
    inputAudioPerMillionTokens: 3.0,
    outputAudioPerMillionTokens: 12.0,
  },
  /** OpenAI Realtime gpt-realtime / gpt-realtime-mini — approximate token rates. */
  openaiRealtime: {
    inputTextPerMillionTokens: 5.0,
    outputTextPerMillionTokens: 20.0,
    inputAudioPerMillionTokens: 32.0,
    outputAudioPerMillionTokens: 64.0,
  },
  openaiRealtimeMini: {
    inputTextPerMillionTokens: 2.5,
    outputTextPerMillionTokens: 10.0,
    inputAudioPerMillionTokens: 10.0,
    outputAudioPerMillionTokens: 20.0,
  },
} as const;

export interface CallUsage {
  sttAudioDurationMs: number;
  llmPromptTokens: number;
  llmCachedPromptTokens: number;
  llmCompletionTokens: number;
  ttsCharacters: number;
}

export type S2sCostProvider = 'openai' | 'openai_mini' | 'gemini';

export interface S2sCallUsage {
  inputTextTokens: number;
  inputAudioTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
  /** Total tokens reported by the provider (may include thoughts / other). */
  totalTokens: number;
  turns: number;
}

export interface S2sCostBreakdown {
  totalUsd: number;
  inputTextUsd: number;
  inputAudioUsd: number;
  outputTextUsd: number;
  outputAudioUsd: number;
  totalInr: number;
  provider: S2sCostProvider;
}

export interface CostBreakdown {
  totalUsd: number;
  llmUsd: number;
  ttsUsd: number;
  sttUsd: number;
}

export interface UsageDisplayBreakdown {
  llmPromptTokens: number;
  llmCachedPromptTokens: number;
  llmCompletionTokens: number;
  llmTotalTokens: number;
  ttsCharacters: number;
  sttAudioDurationMs: number;
}

export function usageDisplayFromMetrics(metrics: {
  totalSttAudioDurationMs?: number;
  totalLlmPromptTokens?: number;
  totalLlmCachedPromptTokens?: number;
  totalLlmCompletionTokens?: number;
  totalTtsCharacters?: number;
}): UsageDisplayBreakdown {
  const llmPromptTokens = metrics.totalLlmPromptTokens ?? 0;
  const llmCachedPromptTokens = Math.min(
    metrics.totalLlmCachedPromptTokens ?? 0,
    llmPromptTokens,
  );
  const llmCompletionTokens = metrics.totalLlmCompletionTokens ?? 0;
  return {
    llmPromptTokens,
    llmCachedPromptTokens,
    llmCompletionTokens,
    llmTotalTokens: llmPromptTokens + llmCompletionTokens,
    ttsCharacters: metrics.totalTtsCharacters ?? 0,
    sttAudioDurationMs: metrics.totalSttAudioDurationMs ?? 0,
  };
}

export function formatTokenCount(n: number): string {
  if (n <= 0) return '—';
  return n.toLocaleString();
}

export function formatCharacterCount(n: number): string {
  if (n <= 0) return '—';
  return n.toLocaleString();
}

export function formatAudioDurationMs(ms: number): string {
  if (ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function usageFromMetrics(metrics: {
  totalSttAudioDurationMs?: number;
  totalLlmPromptTokens?: number;
  totalLlmCachedPromptTokens?: number;
  totalLlmCompletionTokens?: number;
  totalTtsCharacters?: number;
}): CallUsage {
  const llmPromptTokens = metrics.totalLlmPromptTokens ?? 0;
  return {
    sttAudioDurationMs: metrics.totalSttAudioDurationMs ?? 0,
    llmPromptTokens,
    llmCachedPromptTokens: Math.min(metrics.totalLlmCachedPromptTokens ?? 0, llmPromptTokens),
    llmCompletionTokens: metrics.totalLlmCompletionTokens ?? 0,
    ttsCharacters: metrics.totalTtsCharacters ?? 0,
  };
}

export function estimateCallCost(usage: CallUsage, llmProvider: LlmProvider = 'groq'): CostBreakdown {
  const sttUsd =
    (usage.sttAudioDurationMs / 3_600_000) * PUBLISHED_PRICING_USD.azureSttPerAudioHour;

  const llmRates =
    llmProvider === 'gpt' ? PUBLISHED_PRICING_USD.gpt : PUBLISHED_PRICING_USD.groq;
  const cached = Math.min(usage.llmCachedPromptTokens ?? 0, usage.llmPromptTokens);
  const uncached = Math.max(0, usage.llmPromptTokens - cached);
  const cachedInputRate =
    llmProvider === 'gpt'
      ? PUBLISHED_PRICING_USD.gpt.cachedInputPerMillionTokens
      : llmRates.inputPerMillionTokens;
  const llmUsd =
    (uncached / 1_000_000) * llmRates.inputPerMillionTokens +
    (cached / 1_000_000) * cachedInputRate +
    (usage.llmCompletionTokens / 1_000_000) * llmRates.outputPerMillionTokens;

  const ttsUsd =
    (usage.ttsCharacters / 1_000_000) * PUBLISHED_PRICING_USD.cartesiaPerMillionCharacters;

  const totalUsd = sttUsd + llmUsd + ttsUsd;

  return { totalUsd, llmUsd, ttsUsd, sttUsd };
}

export function resolveS2sCostProvider(
  provider?: string | null,
  model?: string | null,
): S2sCostProvider {
  if (provider === 'gemini' || model?.includes('gemini')) return 'gemini';
  if (model?.includes('mini')) return 'openai_mini';
  return 'openai';
}

export function s2sUsageFromMetrics(metrics: {
  totalS2sInputTextTokens?: number;
  totalS2sInputAudioTokens?: number;
  totalS2sOutputTextTokens?: number;
  totalS2sOutputAudioTokens?: number;
  totalS2sTokens?: number;
  userTurns?: number;
  agentTurns?: number;
}): S2sCallUsage {
  const inputTextTokens = metrics.totalS2sInputTextTokens ?? 0;
  const inputAudioTokens = metrics.totalS2sInputAudioTokens ?? 0;
  const outputTextTokens = metrics.totalS2sOutputTextTokens ?? 0;
  const outputAudioTokens = metrics.totalS2sOutputAudioTokens ?? 0;
  const totalTokens =
    metrics.totalS2sTokens ??
    inputTextTokens + inputAudioTokens + outputTextTokens + outputAudioTokens;
  return {
    inputTextTokens,
    inputAudioTokens,
    outputTextTokens,
    outputAudioTokens,
    totalTokens,
    turns: Math.max(metrics.userTurns ?? 0, metrics.agentTurns ?? 0),
  };
}

export function estimateS2sCallCost(
  usage: S2sCallUsage,
  provider: S2sCostProvider = 'openai',
): S2sCostBreakdown {
  const rates =
    provider === 'gemini'
      ? PUBLISHED_PRICING_USD.geminiLive
      : provider === 'openai_mini'
        ? PUBLISHED_PRICING_USD.openaiRealtimeMini
        : PUBLISHED_PRICING_USD.openaiRealtime;

  const inputTextUsd = (usage.inputTextTokens / 1_000_000) * rates.inputTextPerMillionTokens;
  const inputAudioUsd = (usage.inputAudioTokens / 1_000_000) * rates.inputAudioPerMillionTokens;
  const outputTextUsd = (usage.outputTextTokens / 1_000_000) * rates.outputTextPerMillionTokens;
  const outputAudioUsd = (usage.outputAudioTokens / 1_000_000) * rates.outputAudioPerMillionTokens;
  const totalUsd = inputTextUsd + inputAudioUsd + outputTextUsd + outputAudioUsd;

  return {
    totalUsd,
    inputTextUsd,
    inputAudioUsd,
    outputTextUsd,
    outputAudioUsd,
    totalInr: totalUsd * USD_TO_INR,
    provider,
  };
}

export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function formatInr(inr: number): string {
  if (inr > 0 && inr < 0.5) return '<₹0.50';
  if (inr < 10) return `₹${inr.toFixed(2)}`;
  return `₹${Math.round(inr).toLocaleString('en-IN')}`;
}
