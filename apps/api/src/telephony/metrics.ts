import type { TelephonyTurnMetrics, TelephonyUsageSnapshot } from './event-types.js';

export interface TelephonyCallMetrics {
  callDurationSec: number;
  userTurns: number;
  agentTurns: number;
  lastSttMs?: number;
  lastLlmTtftMs?: number;
  lastTtsTtfbMs?: number;
  lastEouDelayMs?: number;
  lastE2eMs?: number;
  lastResponseLatencyMs?: number;
  avgResponseLatencyMs?: number;
  responseLatencySamples?: number;
  lastFeltResponseMs?: number;
  avgFeltResponseMs?: number;
  feltResponseSamples?: number;
  lastTurnBundled?: boolean;
  totalLlmTokens?: number;
  totalSttAudioDurationMs?: number;
  totalLlmPromptTokens?: number;
  totalLlmCachedPromptTokens?: number;
  totalLlmCompletionTokens?: number;
  totalTtsCharacters?: number;
  totalS2sInputTextTokens?: number;
  totalS2sInputAudioTokens?: number;
  totalS2sOutputTextTokens?: number;
  totalS2sOutputAudioTokens?: number;
  totalS2sTokens?: number;
}

export class TelephonyMetricsAccumulator {
  readonly #startedAt = Date.now();
  #userTurns = 0;
  #agentTurns = 0;
  #promptTokens = 0;
  #cachedPromptTokens = 0;
  #completionTokens = 0;
  #ttsChars = 0;
  #sttAudioMs = 0;
  #s2sInputText = 0;
  #s2sInputAudio = 0;
  #s2sOutputText = 0;
  #s2sOutputAudio = 0;
  #s2sTotal = 0;
  #feltSum = 0;
  #feltSamples = 0;
  #responseSum = 0;
  #responseSamples = 0;
  last: TelephonyTurnMetrics = {};

  addUserTurn(): void {
    this.#userTurns += 1;
  }

  addAgentTurn(): void {
    this.#agentTurns += 1;
  }

  addLlmUsage(
    promptTokens?: number,
    completionTokens?: number,
    cachedPromptTokens?: number,
  ): TelephonyUsageSnapshot {
    if (promptTokens) this.#promptTokens += promptTokens;
    if (completionTokens) this.#completionTokens += completionTokens;
    if (cachedPromptTokens) this.#cachedPromptTokens += cachedPromptTokens;
    return this.usageSnapshot();
  }

  addS2sUsage(usage: {
    inputTextTokens?: number;
    inputAudioTokens?: number;
    outputTextTokens?: number;
    outputAudioTokens?: number;
    totalTokens?: number;
  }): TelephonyUsageSnapshot {
    if (usage.inputTextTokens) this.#s2sInputText += usage.inputTextTokens;
    if (usage.inputAudioTokens) this.#s2sInputAudio += usage.inputAudioTokens;
    if (usage.outputTextTokens) this.#s2sOutputText += usage.outputTextTokens;
    if (usage.outputAudioTokens) this.#s2sOutputAudio += usage.outputAudioTokens;
    if (usage.totalTokens) this.#s2sTotal += usage.totalTokens;
    if (usage.inputTextTokens || usage.inputAudioTokens) {
      this.#promptTokens += (usage.inputTextTokens ?? 0) + (usage.inputAudioTokens ?? 0);
    }
    if (usage.outputTextTokens || usage.outputAudioTokens) {
      this.#completionTokens += (usage.outputTextTokens ?? 0) + (usage.outputAudioTokens ?? 0);
    }
    return this.usageSnapshot();
  }

  addTtsChars(count: number): TelephonyUsageSnapshot {
    this.#ttsChars += count;
    return this.usageSnapshot();
  }

  addSttAudioMs(ms: number): TelephonyUsageSnapshot {
    this.#sttAudioMs += ms;
    return this.usageSnapshot();
  }

  recordTurn(metrics: TelephonyTurnMetrics): TelephonyTurnMetrics {
    this.last = metrics;
    if (metrics.feltResponseMs != null) {
      this.#feltSum += metrics.feltResponseMs;
      this.#feltSamples += 1;
    }
    if (metrics.responseLatencyMs != null) {
      this.#responseSum += metrics.responseLatencyMs;
      this.#responseSamples += 1;
    }
    return metrics;
  }

  usageSnapshot(): TelephonyUsageSnapshot {
    return {
      llmTokensIn: this.#promptTokens || undefined,
      llmTokensOut: this.#completionTokens || undefined,
      llmTokensCached: this.#cachedPromptTokens || undefined,
      ttsChars: this.#ttsChars || undefined,
      sttMs: this.#sttAudioMs || undefined,
      userTurns: this.#userTurns,
      agentTurns: this.#agentTurns,
      s2sInputTextTokens: this.#s2sInputText || undefined,
      s2sInputAudioTokens: this.#s2sInputAudio || undefined,
      s2sOutputTextTokens: this.#s2sOutputText || undefined,
      s2sOutputAudioTokens: this.#s2sOutputAudio || undefined,
      s2sTotalTokens: this.#s2sTotal || undefined,
    };
  }

  snapshot(): TelephonyCallMetrics {
    return {
      callDurationSec: Math.floor((Date.now() - this.#startedAt) / 1000),
      userTurns: this.#userTurns,
      agentTurns: this.#agentTurns,
      lastSttMs: this.last.sttMs,
      lastLlmTtftMs: this.last.llmTtftMs,
      lastTtsTtfbMs: this.last.ttsTtfbMs,
      lastEouDelayMs: this.last.eouDelayMs,
      lastE2eMs: this.last.e2eMs,
      lastResponseLatencyMs: this.last.responseLatencyMs,
      avgResponseLatencyMs:
        this.#responseSamples > 0 ? this.#responseSum / this.#responseSamples : undefined,
      responseLatencySamples: this.#responseSamples || undefined,
      lastFeltResponseMs: this.last.feltResponseMs,
      avgFeltResponseMs: this.#feltSamples > 0 ? this.#feltSum / this.#feltSamples : undefined,
      feltResponseSamples: this.#feltSamples || undefined,
      lastTurnBundled: true,
      totalLlmTokens: this.#promptTokens + this.#completionTokens || undefined,
      totalSttAudioDurationMs: this.#sttAudioMs || undefined,
      totalLlmPromptTokens: this.#promptTokens || undefined,
      totalLlmCachedPromptTokens: this.#cachedPromptTokens || undefined,
      totalLlmCompletionTokens: this.#completionTokens || undefined,
      totalTtsCharacters: this.#ttsChars || undefined,
      totalS2sInputTextTokens: this.#s2sInputText || undefined,
      totalS2sInputAudioTokens: this.#s2sInputAudio || undefined,
      totalS2sOutputTextTokens: this.#s2sOutputText || undefined,
      totalS2sOutputAudioTokens: this.#s2sOutputAudio || undefined,
      totalS2sTokens: this.#s2sTotal || undefined,
    };
  }
}
