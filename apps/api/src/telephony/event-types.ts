export type TelephonyAgentState = 'listening' | 'thinking' | 'speaking';

export interface TelephonyTranscriptLine {
  id: string;
  role: 'user' | 'agent';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface TelephonyTurnMetrics {
  feltResponseMs?: number;
  responseLatencyMs?: number;
  llmTtftMs?: number;
  ttsTtfbMs?: number;
  eouDelayMs?: number;
  e2eMs?: number;
  sttMs?: number;
}

export interface TelephonyUsageSnapshot {
  llmTokensIn?: number;
  llmTokensOut?: number;
  llmTokensCached?: number;
  ttsChars?: number;
  sttMs?: number;
  userTurns?: number;
  agentTurns?: number;
  s2sInputTextTokens?: number;
  s2sInputAudioTokens?: number;
  s2sOutputTextTokens?: number;
  s2sOutputAudioTokens?: number;
  s2sTotalTokens?: number;
}

export type TelephonyEvent =
  | { type: 'status'; status: string; ts?: number }
  | { type: 'agent_state'; state: TelephonyAgentState; ts?: number }
  | { type: 'transcript'; line: TelephonyTranscriptLine; ts?: number }
  | ({ type: 'turn_metrics'; ts?: number } & TelephonyTurnMetrics)
  | ({ type: 'usage'; ts?: number } & TelephonyUsageSnapshot)
  | {
      type: 'log';
      level: 'info' | 'warn' | 'error';
      category?: string;
      message: string;
      detail?: unknown;
      ts?: number;
    }
  | { type: 'error'; message: string; ts?: number };
