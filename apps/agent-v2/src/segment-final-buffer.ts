import { mergeUserUtterance, normalizeHeard } from '@vsa/shared';

/** Debounce Sarvam/Google segment finals in Simulator 2.0 (same idea as phone telephony). */
export function resolveSegmentFinalDebounceMs(): number {
  const raw =
    process.env.SIMULATOR_SEGMENT_FINAL_MS?.trim() ??
    process.env.TELEPHONY_SEGMENT_FINAL_MS?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 400 && n <= 4000) return n;
  return 1200;
}

/**
 * Coalesce rapid segment finals (Sarvam END_SPEECH) into one user utterance.
 * Each segment resets the debounce so multi-sentence explanations stay one turn.
 */
export class SegmentFinalBuffer {
  #accumulated = '';
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;
  #lastFlushedNorm = '';
  #lastFlushedAt = 0;

  constructor(
    private readonly debounceMs: number,
    private readonly handlers: {
      onFinal: (text: string) => void;
      onInterim?: (text: string) => void;
    },
  ) {}

  ingest(text: string, kind: 'interim' | 'segment_end'): void {
    if (this.#closed) return;
    const chunk = text.trim();
    if (chunk) {
      this.#accumulated = mergeUserUtterance(this.#accumulated, chunk);
    }
    const live = this.#accumulated.trim();
    if (live && this.handlers.onInterim) {
      this.handlers.onInterim(live);
    }
    if (kind === 'interim' || kind === 'segment_end') {
      this.#armFlush();
    }
  }

  #armFlush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    if (!this.#accumulated.trim()) return;
    this.#timer = setTimeout(() => this.#flush(), this.debounceMs);
  }

  #flush(): void {
    this.#timer = undefined;
    const text = this.#accumulated.trim();
    this.#accumulated = '';
    if (!text) return;
    const norm = normalizeHeard(text);
    const now = Date.now();
    if (norm && norm === this.#lastFlushedNorm && now - this.#lastFlushedAt < 3000) {
      return;
    }
    this.#lastFlushedNorm = norm;
    this.#lastFlushedAt = now;
    this.handlers.onFinal(text);
  }

  close(): void {
    this.#closed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#flush();
  }
}
