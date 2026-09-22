import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type AgentSummary,
  type LeadRow,
  createLead,
  listAgents,
  listLeads,
  updateLead,
} from '../api';

const PAGE_SIZES = [10, 20, 50] as const;
const MANUAL_SOURCE = 'manual';

function formatTs(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(new Date(iso))
      .replace(',', '');
  } catch {
    return iso;
  }
}

function whatsappHref(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const e164 = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${e164}`;
}

/** Same mobile = same lead — last 10 digits. */
function normalizePhoneKey(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

type ContactGroup = {
  key: string;
  phone: string | null;
  primary: LeadRow;
  entries: LeadRow[];
};

function groupLeadsByPhone(leads: LeadRow[]): ContactGroup[] {
  const map = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    const phoneKey = normalizePhoneKey(lead.phone);
    const key = phoneKey ? `p:${phoneKey}` : `id:${lead.id}`;
    const list = map.get(key) ?? [];
    list.push(lead);
    map.set(key, list);
  }
  const groups: ContactGroup[] = [];
  for (const [key, entries] of map) {
    const sorted = [...entries].sort(
      (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime(),
    );
    const primary = sorted[0]!;
    groups.push({
      key,
      phone: primary.phone ?? null,
      primary,
      entries: sorted,
    });
  }
  groups.sort(
    (a, b) =>
      new Date(b.primary.updatedAt || b.primary.createdAt).getTime() -
      new Date(a.primary.updatedAt || a.primary.createdAt).getTime(),
  );
  return groups;
}

function statusDotClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'confirmed' || s === 'completed' || s === 'no issues' || s === 'renewal done') {
    return 'al-dot al-dot-ok';
  }
  if (s === 'new' || s === 'pending' || s === 'follow up' || s === 'follow_up') {
    return 'al-dot al-dot-follow';
  }
  if (s === 'cancelled' || s === 'canceled' || s === 'no_show') return 'al-dot al-dot-muted';
  return 'al-dot al-dot-other';
}

/** Display label for lead status (CRM-style). */
function leadStatusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === 'new' || s === 'pending') return 'Follow Up';
  if (s === 'confirmed') return 'No Issues';
  if (s === 'completed') return 'Renewal Done';
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  if (s === 'no_show') return 'No Show';
  return status;
}

function avatarTone(name: string): string {
  const tones = ['al-av-1', 'al-av-2', 'al-av-3', 'al-av-4', 'al-av-5'];
  let n = 0;
  for (let i = 0; i < name.length; i++) n += name.charCodeAt(i);
  return tones[n % tones.length]!;
}

function displayEmail(email?: string | null): string | null {
  if (!email || email.includes('pending@voice.local')) return null;
  return email;
}

function IconEye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M9 7V5h6v2M8 7l1 13h6l1-13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconWhatsApp() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.15 6.4 2.15 11.83c0 1.99.58 3.84 1.6 5.42L2 22l4.9-1.68a9.86 9.86 0 0 0 5.14 1.43h.01c5.46 0 9.89-4.4 9.89-9.84C21.94 6.4 17.5 2 12.04 2Zm5.75 13.95c-.24.68-1.4 1.25-1.93 1.33-.5.07-1.13.1-1.82-.11-.42-.13-.96-.31-1.65-.6-2.9-1.25-4.79-4.17-4.93-4.36-.14-.2-1.15-1.53-1.15-2.92 0-1.39.73-2.07.99-2.35.26-.28.57-.35.76-.35h.55c.17 0 .4-.06.63.48.24.56.81 1.97.88 2.11.07.14.12.3.02.49-.1.2-.15.32-.3.49-.14.17-.3.38-.43.51-.14.14-.29.29-.12.57.17.28.75 1.23 1.61 2 .99.88 1.82 1.15 2.1 1.28.28.14.44.11.6-.07.17-.17.7-.81.89-1.09.19-.28.38-.23.63-.14.26.1 1.63.77 1.91.91.28.14.47.21.54.32.07.12.07.68-.17 1.36Z" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.6 3.8c.4-.4 1.1-.5 1.6-.2l2.1 1.3c.5.3.7.9.5 1.4l-.8 2.1c-.1.4 0 .8.3 1.1l2.4 2.4c.3.3.7.4 1.1.3l2.1-.8c.5-.2 1.1 0 1.4.5l1.3 2.1c.3.5.2 1.2-.2 1.6l-1.3 1.3c-.4.4-1 .6-1.6.5-1.5-.2-3.6-1.1-5.7-3.2S6.1 9.6 5.9 8.1c-.1-.6.1-1.2.5-1.6L6.6 3.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type AddForm = {
  name: string;
  phone: string;
  email: string;
  status: string;
  notes: string;
  company: string;
};

const EMPTY_FORM: AddForm = {
  name: '',
  phone: '',
  email: '',
  status: 'new',
  notes: '',
  company: '',
};

export default function ActiveLeadsPage() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentId, setAgentId] = useState('');
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [callingKey, setCallingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<ContactGroup | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);

  useEffect(() => {
    listAgents()
      .then((list) => {
        setAgents(list);
        if (list[0]) setAgentId(list[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load agents'));
  }, []);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listLeads(agentId);
      setLeads(data.leads);
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detail) return;
    const next = groupLeadsByPhone(leads).find((g) => g.key === detail.key) ?? null;
    setDetail(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync when leads change
  }, [leads]);

  const groups = useMemo(() => groupLeadsByPhone(leads), [leads]);

  const statusOptions = useMemo(() => {
    const set = new Set(leads.map((l) => l.status).filter(Boolean));
    return ['all', ...[...set].sort()];
  }, [leads]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter((g) => {
      if (statusFilter !== 'all') {
        const matchStatus = g.entries.some(
          (l) => l.status.toLowerCase() === statusFilter.toLowerCase(),
        );
        if (!matchStatus) return false;
      }
      if (!q) return true;
      const hay = g.entries
        .flatMap((l) => [l.name, l.email, l.phone, l.productInterest, l.notes, l.bookingType, l.source])
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [groups, statusFilter, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, query, pageSize, agentId]);

  async function submitAdd(e: FormEvent) {
    e.preventDefault();
    if (!agentId || !form.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createLead({
        agentId,
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        notes: form.notes.trim() || undefined,
        productInterest: form.company.trim() || undefined,
        preferredTime: 'Not set',
        bookingType: 'demo',
        source: MANUAL_SOURCE,
        skipAvailabilityCheck: true,
      });
      if (form.status !== 'new' && created.id) {
        await updateLead(created.id, { status: form.status });
      }
      setForm(EMPTY_FORM);
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add lead');
    } finally {
      setSaving(false);
    }
  }

  async function removeLead(id: string) {
    if (!window.confirm('Remove this lead entry?')) return;
    try {
      await updateLead(id, { status: 'cancelled' });
      await load();
      if (detail?.entries.some((e) => e.id === id)) {
        setDetail((prev) => {
          if (!prev) return null;
          const entries = prev.entries.filter((e) => e.id !== id);
          if (!entries.length) return null;
          return { ...prev, primary: entries[0]!, entries };
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove lead');
    }
  }

  function callLead(group: ContactGroup) {
    const phone = group.primary.phone?.trim();
    if (!agentId) {
      setError('Select an agent first');
      return;
    }
    if (!phone) {
      setError('No phone number for this lead');
      return;
    }
    setError(null);
    setCallingKey(group.key);
    const params = new URLSearchParams({
      agentId,
      to: phone,
      autodial: '1',
    });
    if (group.primary.name?.trim()) params.set('name', group.primary.name.trim());
    const email = displayEmail(group.primary.email);
    if (email) params.set('email', email);
    navigate(`/outbound?${params.toString()}`);
  }

  async function removeContact(group: ContactGroup) {
    if (
      !window.confirm(
        group.entries.length > 1
          ? `Remove all ${group.entries.length} entries for this mobile number?`
          : 'Remove this lead?',
      )
    ) {
      return;
    }
    try {
      await Promise.all(
        group.entries
          .filter((e) => e.status !== 'cancelled' && e.status !== 'canceled')
          .map((e) => updateLead(e.id, { status: 'cancelled' })),
      );
      await load();
      if (detail?.key === group.key) setDetail(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove lead');
    }
  }

  const selectedAgent = agents.find((a) => a.id === agentId);

  return (
    <div className="al-page">
      <header className="al-header">
        <div>
          <h1 className="al-title">Active leads</h1>
          <p className="al-subtitle">
            All leads for the selected agent
            {selectedAgent ? ` · ${selectedAgent.name}` : ''}
          </p>
        </div>
        <label className="al-field">
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
      </header>

      <div className="al-toolbar">
        <label className="al-field al-field-inline">
          <span>Select Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All statuses' : leadStatusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <input
          className="al-search"
          type="search"
          placeholder="name, email, phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="al-btn" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
        <button
          type="button"
          className="al-btn al-btn-primary"
          onClick={() => {
            setForm(EMPTY_FORM);
            setShowAdd(true);
          }}
          disabled={!agentId}
        >
          + Add
        </button>
      </div>

      {error && (
        <div className="al-banner" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="al-table-wrap">
        <table className="al-table">
          <thead>
            <tr>
              <th>S.No.</th>
              <th>Name</th>
              <th>Email</th>
              <th>Mobile</th>
              <th>Lead Update Date</th>
              <th>LeadStatus</th>
              <th>Preferred / scheduled</th>
              <th>Booking type</th>
              <th>Source</th>
              <th>Entry Date</th>
              <th className="al-th-action">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={11} className="al-empty-cell">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && pageRows.length === 0 && (
              <tr>
                <td colSpan={11} className="al-empty-cell">
                  No leads for this agent yet. Use <strong>+ Add</strong> or book via a call.
                </td>
              </tr>
            )}
            {!loading &&
              pageRows.map((g, i) => {
                const l = g.primary;
                const wa = whatsappHref(l.phone);
                const sno = (safePage - 1) * pageSize + i + 1;
                const email = displayEmail(l.email);
                const initial = (l.name.trim()[0] || '?').toUpperCase();
                const preferred =
                  formatTs(l.scheduledStart) !== '—'
                    ? formatTs(l.scheduledStart)
                    : l.preferredTime || '—';
                return (
                  <tr key={g.key} className={i % 2 === 1 ? 'al-row-alt' : undefined}>
                    <td className="al-td-sno">{sno}</td>
                    <td>
                      <span className="al-name-cell">
                        <span className={`al-avatar ${avatarTone(l.name)}`} aria-hidden>
                          {initial}
                        </span>
                        <span className="al-strong">{l.name}</span>
                        {g.entries.length > 1 && (
                          <span className="al-badge" title={`${g.entries.length} entries on this number`}>
                            {g.entries.length}
                          </span>
                        )}
                      </span>
                    </td>
                    <td>
                      {email ? (
                        <a className="al-link" href={`mailto:${email}`}>
                          {email}
                        </a>
                      ) : (
                        <span className="al-muted">—</span>
                      )}
                    </td>
                    <td>
                      {l.phone ? (
                        <span className="al-phone">
                          <span>{l.phone}</span>
                          {wa && (
                            <a
                              className="al-wa"
                              href={wa}
                              target="_blank"
                              rel="noreferrer"
                              title="WhatsApp"
                              aria-label={`WhatsApp ${l.phone}`}
                            >
                              <IconWhatsApp />
                            </a>
                          )}
                        </span>
                      ) : (
                        <span className="al-muted">—</span>
                      )}
                    </td>
                    <td>{formatTs(l.updatedAt || l.createdAt)}</td>
                    <td>
                      <span className="al-status">
                        <i className={statusDotClass(l.status)} aria-hidden />
                        {l.status}
                      </span>
                    </td>
                    <td>{preferred}</td>
                    <td>{(l.bookingType || '—').replace(/_/g, ' ')}</td>
                    <td>{(l.source || '—').replace(/_/g, ' ')}</td>
                    <td>{formatTs(l.createdAt)}</td>
                    <td className="al-td-action">
                      <div className="al-actions">
                        <button
                          type="button"
                          className="al-icon-btn al-icon-call"
                          title={
                            l.phone?.trim()
                              ? `Call ${l.phone.trim()}`
                              : 'No phone number'
                          }
                          aria-label={`Call ${l.name}`}
                          disabled={!l.phone?.trim() || callingKey === g.key}
                          onClick={() => callLead(g)}
                        >
                          <IconPhone />
                        </button>
                        <button
                          type="button"
                          className="al-icon-btn al-icon-view"
                          title="View lead"
                          aria-label={`View ${l.name}`}
                          onClick={() => setDetail(g)}
                        >
                          <IconEye />
                        </button>
                        <button
                          type="button"
                          className="al-icon-btn al-icon-danger"
                          title="Delete lead"
                          aria-label={`Delete ${l.name}`}
                          onClick={() => void removeContact(g)}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <footer className="al-footer">
        <label className="al-field al-field-inline">
          <span>Show</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number])}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="al-total">Total Count: {filtered.length}</span>
        <div className="al-pager">
          <button
            type="button"
            className="al-btn"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span>
            {safePage} / {totalPages}
          </span>
          <button
            type="button"
            className="al-btn"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      </footer>

      {showAdd && (
        <div className="al-modal-backdrop" role="presentation" onClick={() => setShowAdd(false)}>
          <div
            className="al-modal"
            role="dialog"
            aria-modal
            aria-labelledby="al-add-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="al-modal-head">
              <h2 id="al-add-title">Add lead</h2>
              <button type="button" className="al-btn" onClick={() => setShowAdd(false)}>
                Close
              </button>
            </div>
            <form className="al-form" onSubmit={(e) => void submitAdd(e)}>
              <label className="al-field">
                <span>Name *</span>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="al-field">
                <span>Company</span>
                <input
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                />
              </label>
              <label className="al-field">
                <span>Mobile</span>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="9876543210"
                />
              </label>
              <label className="al-field">
                <span>Email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <label className="al-field">
                <span>Status</span>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="new">new</option>
                  <option value="confirmed">confirmed</option>
                  <option value="completed">completed</option>
                </select>
              </label>
              <label className="al-field al-field-full">
                <span>Notes</span>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              <div className="al-form-actions">
                <button type="button" className="al-btn" onClick={() => setShowAdd(false)}>
                  Cancel
                </button>
                <button type="submit" className="al-btn al-btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detail && (
        <div className="al-modal-backdrop" role="presentation" onClick={() => setDetail(null)}>
          <div
            className="al-modal al-modal-wide"
            role="dialog"
            aria-modal
            aria-labelledby="al-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="al-modal-head">
              <div>
                <h2 id="al-detail-title">{detail.primary.name}</h2>
                <p className="al-modal-sub">
                  {detail.phone
                    ? `Same mobile · ${detail.phone} · ${detail.entries.length} entr${detail.entries.length === 1 ? 'y' : 'ies'}`
                    : 'No mobile on file'}
                </p>
              </div>
              <button type="button" className="al-btn" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
            <dl className="al-detail-grid">
              <div>
                <dt>Phone</dt>
                <dd>{detail.phone || '—'}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{displayEmail(detail.primary.email) || '—'}</dd>
              </div>
              <div>
                <dt>Latest status</dt>
                <dd>{detail.primary.status}</dd>
              </div>
              <div>
                <dt>Company / interest</dt>
                <dd>{detail.primary.productInterest || '—'}</dd>
              </div>
            </dl>

            <h3 className="al-history-title">All entries for this number</h3>
            <div className="al-history-wrap">
              <table className="al-history-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Booking</th>
                    <th>Preferred / scheduled</th>
                    <th>Source</th>
                    <th>Entry</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.entries.map((e, idx) => (
                    <tr key={e.id}>
                      <td>{idx + 1}</td>
                      <td>{e.name}</td>
                      <td>
                        <span className="al-status">
                          <i className={statusDotClass(e.status)} aria-hidden />
                          {e.status}
                        </span>
                      </td>
                      <td>{(e.bookingType || '—').replace(/_/g, ' ')}</td>
                      <td>
                        {formatTs(e.scheduledStart) !== '—'
                          ? formatTs(e.scheduledStart)
                          : e.preferredTime || '—'}
                      </td>
                      <td>{(e.source || '—').replace(/_/g, ' ')}</td>
                      <td>{formatTs(e.createdAt)}</td>
                      <td className="al-notes-cell">{e.notes || '—'}</td>
                      <td>
                        {e.status !== 'cancelled' && e.status !== 'canceled' && (
                          <button
                            type="button"
                            className="al-icon-btn al-icon-danger"
                            title="Cancel this entry"
                            onClick={() => void removeLead(e.id)}
                          >
                            <IconTrash />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
