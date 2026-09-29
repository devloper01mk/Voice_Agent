import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type AgentSummary,
  type CallListItem,
  type CallbackRow,
  type DaySlot,
  type LeadRow,
  type MonthDaySummary,
  getCalendarDay,
  getCalendarMonth,
  getCall,
  listAgents,
  listCalls,
  listLeads,
  updateLead,
} from '../api';

type Tab = 'calendar' | 'calls' | 'bookings';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayIstIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatIst(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatTimeIst(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

function formatDayHeading(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!, 6, 30, 0));
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(utc);
}

function durationLabel(startedAt: string, endedAt?: string | null): string {
  if (!endedAt) return 'In progress';
  const sec = Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
  );
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function bookingTypeLabel(type: string): string {
  return type.replace(/_/g, ' ');
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'cancelled' || s === 'canceled' || s === 'no_show') return 'lc-pill lc-pill-muted';
  if (s === 'confirmed' || s === 'completed') return 'lc-pill lc-pill-ok';
  if (s === 'new' || s === 'pending') return 'lc-pill lc-pill-new';
  return 'lc-pill';
}

export default function LeadsPage() {
  const now = new Date();
  const todayIso = todayIstIso();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentId, setAgentId] = useState('');
  const [tab, setTab] = useState<Tab>('calendar');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [days, setDays] = useState<MonthDaySummary[]>([]);
  const [bookingWindow, setBookingWindow] = useState('Calendar off — any day');
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<DaySlot[]>([]);
  const [dayLoading, setDayLoading] = useState(false);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [callbacks, setCallbacks] = useState<CallbackRow[]>([]);
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [callDirection, setCallDirection] = useState<'all' | 'inbound' | 'outbound'>('all');
  const [transcriptCallId, setTranscriptCallId] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAgents()
      .then((list) => {
        setAgents(list);
        if (list[0]) setAgentId(list[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load agents'));
  }, []);

  const loadMonth = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getCalendarMonth(agentId, year, month);
      setDays(data.days);
      setCalendarEnabled(data.calendarEnabled === true);
      setBookingWindow(
        data.bookingWindow ??
          (data.calendarEnabled ? 'Open hours from Studio Calendar' : 'Calendar off — any day'),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load month');
    } finally {
      setLoading(false);
    }
  }, [agentId, year, month]);

  const loadDay = useCallback(
    async (date: string) => {
      if (!agentId) return;
      setSelectedDate(date);
      setDayLoading(true);
      try {
        const data = await getCalendarDay(agentId, date);
        setSlots(data.slots);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load day');
      } finally {
        setDayLoading(false);
      }
    },
    [agentId],
  );

  const loadBookings = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listLeads(agentId);
      setLeads(data.leads);
      setCallbacks(data.callbacks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const loadCalls = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listCalls(agentId, {
        direction: callDirection === 'all' ? undefined : callDirection,
        take: 100,
      });
      setCalls(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load calls');
    } finally {
      setLoading(false);
    }
  }, [agentId, callDirection]);

  useEffect(() => {
    if (!agentId) return;
    if (tab === 'calendar') void loadMonth();
    if (tab === 'bookings') void loadBookings();
    if (tab === 'calls') void loadCalls();
  }, [agentId, tab, loadMonth, loadBookings, loadCalls]);

  // Auto-open today (or first open day) once when month data arrives
  useEffect(() => {
    if (tab !== 'calendar' || !days.length || !agentId || selectedDate) return;
    const inThisMonth =
      year === Number(todayIso.slice(0, 4)) && month === Number(todayIso.slice(5, 7));
    const target =
      inThisMonth && days.some((d) => d.date === todayIso)
        ? todayIso
        : (days.find((d) => d.isOpen) ?? days[0])?.date;
    if (target) void loadDay(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed selection when month loads
  }, [days, agentId, tab, year, month]);

  const calendarCells = useMemo(() => {
    const first = days[0];
    const pad = first?.weekdayIndex ?? 0;
    const blanks = Array.from({ length: pad }, (_, i) => ({ blank: true as const, key: `b${i}` }));
    return [...blanks, ...days.map((d) => ({ blank: false as const, key: d.date, day: d }))];
  }, [days]);

  const monthStats = useMemo(() => {
    const bookings = days.reduce((n, d) => n + d.bookingCount, 0);
    const openDays = days.filter((d) => d.isOpen).length;
    const freeDays = days.filter((d) => d.hasAvailability).length;
    return { bookings, openDays, freeDays };
  }, [days]);

  const slotStats = useMemo(() => {
    const free = slots.filter((s) => s.status === 'free').length;
    const full = slots.filter((s) => s.status === 'full').length;
    const booked = slots.filter((s) => s.status === 'booked' || s.status === 'full').length;
    return { free, full, booked, total: slots.length };
  }, [slots]);

  const activeLeads = useMemo(
    () => leads.filter((l) => !['cancelled', 'canceled'].includes(l.status.toLowerCase())),
    [leads],
  );

  async function openTranscript(callId: string) {
    setTranscriptCallId(callId);
    setTranscriptText('Loading…');
    try {
      const call = await getCall(callId);
      const payload = call.transcript;
      const lines = Array.isArray(payload) ? payload : (payload?.lines ?? []);
      setTranscriptText(
        lines.length
          ? lines
              .map(
                (l: { role?: string; text?: string }) =>
                  `${l.role === 'user' ? 'Caller' : 'Agent'}: ${l.text ?? ''}`,
              )
              .join('\n\n')
          : 'No transcript saved.',
      );
    } catch {
      setTranscriptText('Failed to load transcript.');
    }
  }

  async function cancelLead(id: string) {
    try {
      await updateLead(id, { status: 'cancelled' });
      await loadBookings();
      if (tab === 'calendar') {
        await loadMonth();
        if (selectedDate) await loadDay(selectedDate);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel');
    }
  }

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setMonth(m);
    setYear(y);
    setSelectedDate(null);
    setSlots([]);
  }

  function goToday() {
    const [y, m] = todayIso.split('-').map(Number);
    setYear(y!);
    setMonth(m!);
    setSelectedDate(null);
    setSlots([]);
    setTab('calendar');
  }

  const tabCounts: Record<Tab, number | null> = {
    calendar: monthStats.bookings,
    calls: calls.length || null,
    bookings: activeLeads.length || null,
  };

  return (
    <div className="lc-page">
      <header className="lc-header">
        <div className="lc-header-text">
          <p className="lc-eyebrow">Sales desk</p>
          <h1 className="lc-title">Leads & Calendar</h1>
          <p className="lc-subtitle">
            {calendarEnabled
              ? `Bookings ${bookingWindow} · inbound & outbound calls`
              : `${bookingWindow} · set open hours in Studio → Calendar`}
          </p>
        </div>
        <div className="lc-header-actions">
          <label className="lc-field">
            <span>Agent</span>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.length === 0 && <option value="">No agents</option>}
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="lc-btn lc-btn-ghost" onClick={goToday}>
            Today
          </button>
        </div>
      </header>

      {tab === 'calendar' && (
        <div className="lc-stats" aria-label="Month summary">
          <div className="lc-stat">
            <span className="lc-stat-value">{monthStats.bookings}</span>
            <span className="lc-stat-label">Bookings this month</span>
          </div>
          <div className="lc-stat">
            <span className="lc-stat-value">{monthStats.freeDays}</span>
            <span className="lc-stat-label">Days with free slots</span>
          </div>
          <div className="lc-stat">
            <span className="lc-stat-value">{monthStats.openDays}</span>
            <span className="lc-stat-label">Open days</span>
          </div>
          <div className="lc-stat lc-stat-hours">
            <span className="lc-stat-value lc-stat-value-sm">10–7</span>
            <span className="lc-stat-label">IST booking window</span>
          </div>
        </div>
      )}

      <div className="lc-tabs" role="tablist">
        {(
          [
            ['calendar', 'Calendar'],
            ['calls', 'Calls'],
            ['bookings', 'Bookings'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`lc-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
            {tabCounts[id] != null && tabCounts[id]! > 0 && (
              <span className="lc-tab-count">{tabCounts[id]}</span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="lc-banner lc-banner-error" role="alert">
          {error}
          <button type="button" className="lc-banner-dismiss" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {loading && <div className="lc-loading">Loading…</div>}

      {tab === 'calendar' && (
        <div className="lc-calendar">
          <section className="lc-panel lc-month">
            <div className="lc-month-nav">
              <button
                type="button"
                className="lc-icon-btn"
                aria-label="Previous month"
                onClick={() => shiftMonth(-1)}
              >
                ‹
              </button>
              <h2>
                {MONTHS[month - 1]} {year}
              </h2>
              <button
                type="button"
                className="lc-icon-btn"
                aria-label="Next month"
                onClick={() => shiftMonth(1)}
              >
                ›
              </button>
            </div>

            <div className="lc-weekdays">
              {WEEKDAYS.map((d) => (
                <div key={d} className="lc-weekday">
                  {d}
                </div>
              ))}
            </div>

            <div className="lc-month-grid">
              {calendarCells.map((cell) =>
                cell.blank ? (
                  <div key={cell.key} className="lc-day is-blank" />
                ) : (
                  <button
                    key={cell.key}
                    type="button"
                    className={[
                      'lc-day',
                      !cell.day.isOpen ? 'is-closed' : '',
                      selectedDate === cell.day.date ? 'is-selected' : '',
                      cell.day.date === todayIso ? 'is-today' : '',
                      cell.day.bookingCount > 0 ? 'has-bookings' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => void loadDay(cell.day.date)}
                  >
                    <span className="lc-day-num">{Number(cell.day.date.slice(-2))}</span>
                    <span className="lc-day-foot">
                      {cell.day.bookingCount > 0 ? (
                        <span className="lc-day-dots" aria-label={`${cell.day.bookingCount} bookings`}>
                          {Array.from({ length: Math.min(cell.day.bookingCount, 3) }).map((_, i) => (
                            <i key={i} />
                          ))}
                          {cell.day.bookingCount > 3 && (
                            <span className="lc-day-more">+{cell.day.bookingCount - 3}</span>
                          )}
                        </span>
                      ) : cell.day.isOpen ? (
                        <span className="lc-day-open-mark">·</span>
                      ) : (
                        <span className="lc-day-closed-mark">Closed</span>
                      )}
                    </span>
                  </button>
                ),
              )}
            </div>

            <div className="lc-legend">
              <span>
                <i className="lc-swatch lc-swatch-today" /> Today
              </span>
              <span>
                <i className="lc-swatch lc-swatch-booked" /> Has bookings
              </span>
              <span>
                <i className="lc-swatch lc-swatch-closed" /> Closed
              </span>
            </div>
          </section>

          <section className="lc-panel lc-day-detail">
            <div className="lc-day-detail-head">
              <div>
                <h3>{selectedDate ? formatDayHeading(selectedDate) : 'Pick a day'}</h3>
                <p className="lc-muted">
                  {selectedDate
                    ? `${slotStats.free} free · ${slotStats.booked} taken · of ${slotStats.total} slots`
                    : 'Select a date on the left to see 30‑minute slots.'}
                </p>
              </div>
              {selectedDate === todayIso && <span className="lc-pill lc-pill-accent">Today</span>}
            </div>

            {dayLoading && <div className="lc-loading">Loading slots…</div>}

            {!dayLoading && selectedDate && slots.length === 0 && (
              <div className="lc-empty">
                <strong>Closed</strong>
                <p>
                  No bookable slots this day.
                  {calendarEnabled
                    ? ` Open window: ${bookingWindow}.`
                    : ' Calendar is off for this agent — bookings still save without slot limits.'}
                </p>
              </div>
            )}

            {!dayLoading && (
              <ul className="lc-slots">
                {slots.map((slot) => (
                  <li key={slot.start} className={`lc-slot is-${slot.status}`}>
                    <div className="lc-slot-rail" aria-hidden />
                    <div className="lc-slot-body">
                      <div className="lc-slot-time">
                        {formatTimeIst(slot.start)}
                        <span className="lc-slot-sep">–</span>
                        {formatTimeIst(slot.end)}
                      </div>
                      <div className="lc-slot-status">
                        {slot.status === 'free' && <span className="lc-pill lc-pill-ok">Free</span>}
                        {slot.status === 'full' && <span className="lc-pill lc-pill-busy">Full</span>}
                        {slot.status === 'booked' && (
                          <span className="lc-pill lc-pill-warn">Partial</span>
                        )}
                      </div>
                      {slot.bookings.length > 0 && (
                        <ul className="lc-slot-people">
                          {slot.bookings.map((b) => (
                            <li key={b.id}>
                              <strong>{b.name || 'Lead'}</strong>
                              <span>{bookingTypeLabel(b.bookingType || 'demo')}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === 'calls' && (
        <section className="lc-list-section">
          <div className="lc-toolbar">
            <div className="lc-seg" role="group" aria-label="Call direction">
              {(
                [
                  ['all', 'All'],
                  ['inbound', 'Inbound'],
                  ['outbound', 'Outbound'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`lc-seg-btn${callDirection === id ? ' is-active' : ''}`}
                  onClick={() => setCallDirection(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {!loading && calls.length === 0 && (
            <div className="lc-empty">
              <strong>No calls yet</strong>
              <p>Run the Simulator to create inbound or outbound sessions.</p>
            </div>
          )}

          <ul className="lc-cards">
            {calls.map((c) => (
              <li key={c.id} className="lc-card">
                <div className="lc-card-main">
                  <div className="lc-card-title-row">
                    <span
                      className={`lc-pill ${c.direction === 'outbound' ? 'lc-pill-out' : 'lc-pill-in'}`}
                    >
                      {c.direction}
                    </span>
                    <strong className="lc-card-name">{c.prospectName || 'Unknown prospect'}</strong>
                  </div>
                  <div className="lc-card-meta">
                    <span>{formatIst(c.startedAt)}</span>
                    <span>·</span>
                    <span>{durationLabel(c.startedAt, c.endedAt)}</span>
                    {(c.contactPhone || c.contactEmail) && (
                      <>
                        <span>·</span>
                        <span>{c.contactPhone || c.contactEmail}</span>
                      </>
                    )}
                  </div>
                  <div className="lc-card-tags">
                    {c.outcome ? (
                      <span className="lc-pill lc-pill-new">{c.outcome.replace(/_/g, ' ')}</span>
                    ) : (
                      <span className="lc-pill lc-pill-muted">No outcome</span>
                    )}
                    {c.leads[0] && (
                      <span className="lc-pill">
                        {bookingTypeLabel(c.leads[0].bookingType)} · {c.leads[0].status}
                      </span>
                    )}
                    {!c.leads[0] && c.callbacks[0] && (
                      <span className="lc-pill">Callback · {c.callbacks[0].status}</span>
                    )}
                  </div>
                </div>
                {c.hasTranscript && (
                  <button
                    type="button"
                    className="lc-btn lc-btn-ghost"
                    onClick={() => void openTranscript(c.id)}
                  >
                    Transcript
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'bookings' && (
        <section className="lc-list-section">
          <div className="lc-section-head">
            <h3>Upcoming & recent bookings</h3>
            <p className="lc-muted">{activeLeads.length} active · {leads.length} total</p>
          </div>

          {!loading && leads.length === 0 && (
            <div className="lc-empty">
              <strong>No bookings yet</strong>
              <p>When the voice agent books a demo or test drive, it will show up here and on the calendar.</p>
            </div>
          )}

          <ul className="lc-cards">
            {leads.map((l) => (
              <li key={l.id} className="lc-card">
                <div className="lc-card-main">
                  <div className="lc-card-title-row">
                    <span className="lc-pill lc-pill-accent">{bookingTypeLabel(l.bookingType)}</span>
                    <strong className="lc-card-name">{l.name}</strong>
                    <span className={statusClass(l.status)}>{l.status}</span>
                  </div>
                  <div className="lc-card-meta">
                    <span className="lc-card-when">{formatIst(l.scheduledStart)}</span>
                    {(l.phone || l.email) && (
                      <>
                        <span>·</span>
                        <span>{l.phone || l.email}</span>
                      </>
                    )}
                  </div>
                  <div className="lc-card-tags">
                    <span className="lc-pill lc-pill-muted">
                      Raw: {l.preferredTimeRaw || l.preferredTime}
                    </span>
                    <span className="lc-pill lc-pill-muted">
                      Sync: {l.calendarSyncStatus || '—'}
                    </span>
                    {l.call && (
                      <span
                        className={`lc-pill ${
                          l.call.direction === 'outbound' ? 'lc-pill-out' : 'lc-pill-in'
                        }`}
                      >
                        {l.call.direction} call
                      </span>
                    )}
                  </div>
                </div>
                {l.status !== 'cancelled' && l.status !== 'canceled' && (
                  <button
                    type="button"
                    className="lc-btn lc-btn-danger"
                    onClick={() => void cancelLead(l.id)}
                  >
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="lc-section-head lc-section-head-spaced">
            <h3>Callbacks</h3>
            <p className="lc-muted">{callbacks.length} scheduled</p>
          </div>

          {!loading && callbacks.length === 0 && (
            <div className="lc-empty lc-empty-compact">
              <p>No callback requests yet.</p>
            </div>
          )}

          <ul className="lc-cards">
            {callbacks.map((c) => (
              <li key={c.id} className="lc-card">
                <div className="lc-card-main">
                  <div className="lc-card-title-row">
                    <strong className="lc-card-name">{c.name || 'Callback'}</strong>
                    <span className={statusClass(c.status)}>{c.status}</span>
                  </div>
                  <div className="lc-card-meta">
                    <span>{formatIst(c.scheduledAt)}</span>
                    <span>·</span>
                    <span>{c.preferredTime}</span>
                    {(c.phone || c.email) && (
                      <>
                        <span>·</span>
                        <span>{c.phone || c.email}</span>
                      </>
                    )}
                  </div>
                  {c.reason && <p className="lc-card-note">{c.reason}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {transcriptCallId && (
        <div className="lc-modal-backdrop" onClick={() => setTranscriptCallId(null)}>
          <div
            className="lc-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Call transcript"
          >
            <div className="lc-modal-header">
              <h3>Call transcript</h3>
              <button
                type="button"
                className="lc-icon-btn"
                aria-label="Close"
                onClick={() => setTranscriptCallId(null)}
              >
                ×
              </button>
            </div>
            <pre className="lc-transcript">{transcriptText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
