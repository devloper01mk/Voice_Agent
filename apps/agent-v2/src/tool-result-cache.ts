/**
 * Last result of each tool call, keyed by Gemini call id. The stuck-call guard uses it to
 * deliver the real result when LiveKit dropped the tool response (aborted speech).
 */

const TTL_MS = 5 * 60_000;

type Entry = { output: string; at: number };

const cache = new Map<string, Entry>();

export type ToolCacheEvent =
  | { type: 'result'; callId: string }
  | { type: 'recovered'; callId: string };

type ToolCacheListener = (event: ToolCacheEvent) => void;

const listeners = new Set<ToolCacheListener>();

export function onToolCacheEvent(listener: ToolCacheListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitToolCacheEvent(event: ToolCacheEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* ignore listener errors */
    }
  }
}

function serialize(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result ?? null);
  } catch {
    return String(result);
  }
}

export function rememberToolResult(callId: string | undefined, result: unknown): void {
  if (!callId) return;
  const now = Date.now();
  cache.set(callId, { output: serialize(result), at: now });
  for (const [id, e] of cache) {
    if (now - e.at > TTL_MS) cache.delete(id);
  }
  emitToolCacheEvent({ type: 'result', callId });
}

export function markToolResultRecovered(callId: string): void {
  emitToolCacheEvent({ type: 'recovered', callId });
}

export function peekToolResult(callId: string): Entry | undefined {
  return cache.get(callId);
}

export function forgetToolResult(callId: string): void {
  cache.delete(callId);
}

/** Wrap a LiveKit tool so its result is cached by toolCallId. */
export function withCachedResult<T extends { execute?: (...args: any[]) => unknown }>(toolDef: T): T {
  const original = toolDef.execute;
  if (typeof original !== 'function') return toolDef;
  return {
    ...toolDef,
    execute: async (args: unknown, opts?: { toolCallId?: string }) => {
      const result = await original.call(toolDef, args, opts);
      rememberToolResult(opts?.toolCallId, result);
      return result;
    },
  };
}
