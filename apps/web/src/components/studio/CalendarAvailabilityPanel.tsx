import {
  DEFAULT_AVAILABILITY,
  formatBookingWindowLabel,
  type AvailabilityConfig,
} from '@vsa/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAgentAvailability, saveAgentAvailability } from '../../api';

const WEEKDAYS: { id: number; label: string }[] = [
  { id: 0, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
];

const SLOT_OPTIONS = [15, 30, 45, 60, 90, 120];

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toTimeInput(hour: number, minute: number) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function parseTimeInput(value: string): { hour: number; minute: number } | null {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

type FormState = {
  enabled: boolean;
  openDays: number[];
  dayStartHour: number;
  dayStartMinute: number;
  dayEndHour: number;
  dayEndMinute: number;
  slotMinutes: number;
  capacityPerSlot: number;
  blockedDatesText: string;
};

function configToForm(config: AvailabilityConfig): FormState {
  return {
    enabled: config.enabled,
    openDays: [...config.openDays].sort((a, b) => a - b),
    dayStartHour: config.dayStartHour,
    dayStartMinute: config.dayStartMinute,
    dayEndHour: config.dayEndHour,
    dayEndMinute: config.dayEndMinute,
    slotMinutes: config.slotMinutes,
    capacityPerSlot: config.capacityPerSlot,
    blockedDatesText: (config.blockedDates ?? []).join(', '),
  };
}

function formToPayload(form: FormState) {
  const blockedDates = form.blockedDatesText
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  return {
    enabled: form.enabled,
    openDays: form.openDays.length ? form.openDays : [1, 2, 3, 4, 5, 6],
    dayStartHour: form.dayStartHour,
    dayStartMinute: form.dayStartMinute,
    dayEndHour: form.dayEndHour,
    dayEndMinute: form.dayEndMinute,
    slotMinutes: form.slotMinutes,
    capacityPerSlot: form.capacityPerSlot,
    blockedDates,
  };
}

export default function CalendarAvailabilityPanel({ agentId }: { agentId: string }) {
  const [form, setForm] = useState<FormState>(() => configToForm(DEFAULT_AVAILABILITY));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAgentAvailability(agentId);
      setForm(configToForm(data.config));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const preview = useMemo(() => {
    const payload = formToPayload(form);
    return formatBookingWindowLabel({
      ...DEFAULT_AVAILABILITY,
      ...payload,
      timezone: 'Asia/Kolkata',
      blockedDates: payload.blockedDates,
    });
  }, [form]);

  const toggleDay = (day: number) => {
    setForm((f) => {
      const has = f.openDays.includes(day);
      const openDays = has ? f.openDays.filter((d) => d !== day) : [...f.openDays, day].sort((a, b) => a - b);
      return { ...f, openDays };
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const saved = await saveAgentAvailability(agentId, formToPayload(form));
      setForm(configToForm(saved.config));
      setMessage(
        saved.config.enabled
          ? `Calendar on — bookings use ${saved.bookingWindow}.`
          : 'Calendar off — any day/time can be booked (hotel-style).',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="studio-field-hint">Loading calendar settings…</p>;
  }

  return (
    <div className="studio-calendar-panel">
      <div className="studio-section-header">
        <h2 className="studio-section-title">Appointment calendar</h2>
        <p className="studio-section-desc">
          Per-agent rules. <strong>On</strong> = voice booking must match open days, hours, and
          slots. <strong>Off</strong> = no slot enforcement (good for hotel stays — Mon–Sun any
          date). Leave off if you never save rules.
        </p>
      </div>

      <div className="studio-choice-grid" style={{ marginBottom: '1.25rem' }}>
        <button
          type="button"
          className={`studio-choice-card${form.enabled ? ' selected' : ''}`}
          onClick={() => setForm((f) => ({ ...f, enabled: true }))}
        >
          <strong>Calendar on</strong>
          <span>Enforce the days and hours you set below</span>
        </button>
        <button
          type="button"
          className={`studio-choice-card${!form.enabled ? ' selected' : ''}`}
          onClick={() => setForm((f) => ({ ...f, enabled: false }))}
        >
          <strong>Calendar off</strong>
          <span>Any day / time — skip showroom slot checks</span>
        </button>
      </div>

      <p className="studio-field-hint" style={{ marginBottom: '1rem' }}>
        Preview: <strong>{preview}</strong>
      </p>

      <fieldset disabled={!form.enabled} className="studio-calendar-fields">
        <div className="studio-field">
          <label>Open days</label>
          <div className="studio-weekday-row">
            {WEEKDAYS.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`studio-weekday-chip${form.openDays.includes(d.id) ? ' selected' : ''}`}
                onClick={() => toggleDay(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="studio-field-grid">
          <div className="studio-field">
            <label htmlFor="calStart">Open from</label>
            <input
              id="calStart"
              type="time"
              value={toTimeInput(form.dayStartHour, form.dayStartMinute)}
              onChange={(e) => {
                const t = parseTimeInput(e.target.value);
                if (!t) return;
                setForm((f) => ({ ...f, dayStartHour: t.hour, dayStartMinute: t.minute }));
              }}
            />
          </div>
          <div className="studio-field">
            <label htmlFor="calEnd">Open until</label>
            <input
              id="calEnd"
              type="time"
              value={toTimeInput(form.dayEndHour, form.dayEndMinute)}
              onChange={(e) => {
                const t = parseTimeInput(e.target.value);
                if (!t) return;
                setForm((f) => ({ ...f, dayEndHour: t.hour, dayEndMinute: t.minute }));
              }}
            />
          </div>
          <div className="studio-field">
            <label htmlFor="calSlot">Slot length (minutes)</label>
            <select
              id="calSlot"
              value={form.slotMinutes}
              onChange={(e) => setForm((f) => ({ ...f, slotMinutes: Number(e.target.value) }))}
            >
              {SLOT_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </div>
          <div className="studio-field">
            <label htmlFor="calCap">Bookings per slot</label>
            <input
              id="calCap"
              type="number"
              min={1}
              max={20}
              value={form.capacityPerSlot}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  capacityPerSlot: Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                }))
              }
            />
          </div>
        </div>

        <div className="studio-field">
          <label htmlFor="calBlocked">Blocked dates (optional)</label>
          <input
            id="calBlocked"
            type="text"
            value={form.blockedDatesText}
            onChange={(e) => setForm((f) => ({ ...f, blockedDatesText: e.target.value }))}
            placeholder="e.g. 2026-08-15, 2026-10-02"
          />
          <p className="studio-field-hint">ISO dates YYYY-MM-DD, comma-separated holidays.</p>
        </div>
      </fieldset>

      {error && <p className="error">{error}</p>}
      {message && <p className="studio-field-hint">{message}</p>}

      <div className="sim-setup-actions" style={{ marginTop: '1rem' }}>
        <button type="button" className="btn primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save calendar'}
        </button>
      </div>
    </div>
  );
}
