import { useEffect, useRef, useState } from 'react';
import type { CallMetricsSummary, TranscriptLine } from '../api';
import { apiAuthQueryParam } from '../api';
import type { TelephonyLogEntry } from '../components/TelephonyLogPanel';

export type TelephonyAgentState = 'listening' | 'thinking' | 'speaking' | null;

interface TelephonyLiveEvent {
  type: string;
  ts?: number;
  status?: string;
  state?: TelephonyAgentState;
  line?: TranscriptLine;
  message?: string;
  level?: 'info' | 'warn' | 'error';
  category?: string;
  feltResponseMs?: number;
  responseLatencyMs?: number;
  llmTtftMs?: number;
  ttsTtfbMs?: number;
  eouDelayMs?: number;
  e2eMs?: number;
  sttMs?: number;
  llmTokensIn?: number;
  llmTokensOut?: number;
  llmTokensCached?: number;
  ttsChars?: number;
  userTurns?: number;
  agentTurns?: number;
  s2sInputTextTokens?: number;
  s2sInputAudioTokens?: number;
  s2sOutputTextTokens?: number;
  s2sOutputAudioTokens?: number;
  s2sTotalTokens?: number;
}

const EMPTY_METRICS: CallMetricsSummary = {
  callDurationSec: 0,
  userTurns: 0,
  agentTurns: 0,
};

export function useTelephonyEvents(callId: string | null) {
  const [status, setStatus] = useState<string | null>(null);
  const [agentState, setAgentState] = useState<TelephonyAgentState>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [metrics, setMetrics] = useState<CallMetricsSummary>(EMPTY_METRICS);
  const [logs, setLogs] = useState<TelephonyLogEntry[]>([]);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const logSeq = useRef(0);

  useEffect(() => {
    if (!callId) {
      setStatus(null);
      setAgentState(null);
      setLines([]);
      setMetrics(EMPTY_METRICS);
      setLogs([]);
      setError('');
      setConnected(false);
      return;
    }

    const authQ = apiAuthQueryParam();
    const es = new EventSource(
      `/api/telephony/calls/${callId}/events${authQ ? `?${authQ}` : ''}`,
    );

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (evt) => {
      let msg: TelephonyLiveEvent;
      try {
        msg = JSON.parse(evt.data) as TelephonyLiveEvent;
      } catch {
        return;
      }
      const ts = msg.ts ?? Date.now();

      if (msg.type === 'status' && msg.status) {
        setStatus(msg.status);
        return;
      }
      if (msg.type === 'agent_state' && msg.state) {
        setAgentState(msg.state);
        return;
      }
      if (msg.type === 'transcript' && msg.line) {
        setLines((prev) => {
          if (prev.some((l) => l.id === msg.line!.id)) {
            return prev.map((l) => (l.id === msg.line!.id ? msg.line! : l));
          }
          return [...prev, msg.line!];
        });
        return;
      }
      if (msg.type === 'turn_metrics') {
        setMetrics((prev) => ({
          ...prev,
          lastFeltResponseMs: msg.feltResponseMs ?? prev.lastFeltResponseMs,
          lastResponseLatencyMs: msg.responseLatencyMs ?? prev.lastResponseLatencyMs,
          lastLlmTtftMs: msg.llmTtftMs ?? prev.lastLlmTtftMs,
          lastTtsTtfbMs: msg.ttsTtfbMs ?? prev.lastTtsTtfbMs,
          lastEouDelayMs: msg.eouDelayMs ?? prev.lastEouDelayMs,
          lastE2eMs: msg.e2eMs ?? prev.lastE2eMs,
          lastSttMs: msg.sttMs ?? prev.lastSttMs,
          lastTurnBundled: true,
          avgFeltResponseMs: msg.feltResponseMs
            ? rollingAvg(prev.avgFeltResponseMs, prev.feltResponseSamples, msg.feltResponseMs)
            : prev.avgFeltResponseMs,
          feltResponseSamples: msg.feltResponseMs
            ? (prev.feltResponseSamples ?? 0) + 1
            : prev.feltResponseSamples,
          avgResponseLatencyMs: msg.responseLatencyMs
            ? rollingAvg(prev.avgResponseLatencyMs, prev.responseLatencySamples, msg.responseLatencyMs)
            : prev.avgResponseLatencyMs,
          responseLatencySamples: msg.responseLatencyMs
            ? (prev.responseLatencySamples ?? 0) + 1
            : prev.responseLatencySamples,
        }));
        return;
      }
      if (msg.type === 'usage') {
        setMetrics((prev) => ({
          ...prev,
          totalLlmPromptTokens: msg.llmTokensIn ?? prev.totalLlmPromptTokens,
          totalLlmCachedPromptTokens: msg.llmTokensCached ?? prev.totalLlmCachedPromptTokens,
          totalLlmCompletionTokens: msg.llmTokensOut ?? prev.totalLlmCompletionTokens,
          totalLlmTokens:
            msg.llmTokensIn != null || msg.llmTokensOut != null
              ? (msg.llmTokensIn ?? 0) + (msg.llmTokensOut ?? 0)
              : prev.totalLlmTokens,
          totalTtsCharacters: msg.ttsChars ?? prev.totalTtsCharacters,
          totalSttAudioDurationMs: msg.sttMs ?? prev.totalSttAudioDurationMs,
          userTurns: msg.userTurns ?? prev.userTurns,
          agentTurns: msg.agentTurns ?? prev.agentTurns,
          totalS2sInputTextTokens: msg.s2sInputTextTokens ?? prev.totalS2sInputTextTokens,
          totalS2sInputAudioTokens: msg.s2sInputAudioTokens ?? prev.totalS2sInputAudioTokens,
          totalS2sOutputTextTokens: msg.s2sOutputTextTokens ?? prev.totalS2sOutputTextTokens,
          totalS2sOutputAudioTokens: msg.s2sOutputAudioTokens ?? prev.totalS2sOutputAudioTokens,
          totalS2sTokens: msg.s2sTotalTokens ?? prev.totalS2sTokens,
        }));
        return;
      }
      if (msg.type === 'log' && msg.message) {
        logSeq.current += 1;
        setLogs((prev) => [
          ...prev.slice(-199),
          {
            id: `log-${logSeq.current}`,
            ts,
            level: msg.level ?? 'info',
            category: msg.category,
            message: msg.message!,
          },
        ]);
        return;
      }
      if (msg.type === 'error' && msg.message) {
        setError(msg.message);
        logSeq.current += 1;
        setLogs((prev) => [
          ...prev.slice(-199),
          {
            id: `log-${logSeq.current}`,
            ts,
            level: 'error',
            category: 'error',
            message: msg.message!,
          },
        ]);
      }
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [callId]);

  return { status, agentState, lines, metrics, logs, error, connected, setStatus };
}

function rollingAvg(prevAvg: number | undefined, samples: number | undefined, next: number) {
  const n = samples ?? 0;
  if (n === 0 || prevAvg == null) return next;
  return (prevAvg * n + next) / (n + 1);
}
