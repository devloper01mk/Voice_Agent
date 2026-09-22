export interface TelephonyLogEntry {
  id: string;
  ts: number;
  level: 'info' | 'warn' | 'error';
  category?: string;
  message: string;
}

export default function TelephonyLogPanel({ logs }: { logs: TelephonyLogEntry[] }) {
  return (
    <section className="sim-panel telephony-log-panel">
      <details open>
        <summary className="sim-panel-head telephony-log-summary">
          <span className="sim-panel-icon" aria-hidden>
            🛠
          </span>
          <h2>Debug logs</h2>
          <span className="telephony-log-count">{logs.length}</span>
        </summary>
        <div className="telephony-log-feed">
          {logs.length === 0 && <p className="muted">Logs appear when the call starts.</p>}
          {logs.map((log) => (
            <div key={log.id} className={`telephony-log-line telephony-log-${log.level}`}>
              <span className="telephony-log-time">
                {new Date(log.ts).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              {log.category ? <span className="telephony-log-cat">{log.category}</span> : null}
              <span className="telephony-log-msg">{log.message}</span>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
