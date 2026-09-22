import { useEffect, useRef } from 'react';
import type { TranscriptLine } from '../api';

export default function LiveTranscriptPanel({
  lines,
  emptyMessage,
  userLabel = 'You',
  agentLabel = 'Agent',
  title = 'Live transcript',
}: {
  lines: TranscriptLine[];
  emptyMessage: string;
  userLabel?: string;
  agentLabel?: string;
  title?: string;
}) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTop = feed.scrollHeight;
  }, [lines]);

  return (
    <section className="sim-panel">
      <div className="sim-panel-head">
        <span className="sim-panel-icon" aria-hidden>
          💬
        </span>
        <h2>{title}</h2>
      </div>
      <div className="transcript-feed" ref={feedRef}>
        {lines.length === 0 && <p className="muted">{emptyMessage}</p>}
        {lines.map((line) => (
          <div
            key={line.id}
            className={`transcript-line ${line.role} ${line.isFinal === false ? 'interim' : ''}`}
          >
            <span className="transcript-role">{line.role === 'user' ? userLabel : agentLabel}</span>
            <span className="transcript-text">{line.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
