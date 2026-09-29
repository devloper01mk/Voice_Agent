import {
  PLAYBOOK_TEMPLATES,
  type PlaybookDateMode,
  type PlaybookField,
  type SalesPlaybook,
} from '@vsa/shared';

const DATE_MODES: { id: PlaybookDateMode; label: string }[] = [
  { id: 'single_slot', label: 'One date / time' },
  { id: 'date_range', label: 'Start + end date' },
  { id: 'none', label: 'No date' },
];

const toLines = (list: string[]) => list.join('\n');
const fromLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);

/** "Budget range *" → required field; key kept stable when the label is unchanged. */
function fieldsToLines(fields: PlaybookField[]): string {
  return fields.map((f) => `${f.label}${f.required ? ' *' : ''}`).join('\n');
}

function linesToFields(text: string, previous: PlaybookField[]): PlaybookField[] {
  return fromLines(text).map((line) => {
    const required = /\*\s*$/.test(line);
    const label = line.replace(/\*\s*$/, '').trim();
    const prev = previous.find((f) => f.label === label);
    return { key: prev?.key ?? slug(label), label, required };
  });
}

export function PlaybookPanel({
  playbook,
  derived,
  onChange,
  onApplyTemplate,
  onReset,
}: {
  playbook: SalesPlaybook;
  /** True when nothing is stored yet — shown values come from Booking policy + template. */
  derived: boolean;
  onChange: (next: SalesPlaybook) => void;
  onApplyTemplate: (templateId: string) => void;
  onReset: () => void;
}) {
  const set = (patch: Partial<SalesPlaybook>) => onChange({ ...playbook, ...patch });
  const setGoal = (patch: Partial<SalesPlaybook['goal']>) =>
    onChange({ ...playbook, goal: { ...playbook.goal, ...patch } });

  return (
    <>
      <section className="studio-section">
        <div className="studio-section-header">
          <h2 className="studio-section-title">Sales playbook — how to sell</h2>
          <p className="studio-section-desc">
            Skills (listen, answer first, objections, close on intent) are the same for every agent.
            The playbook is what changes per business: what you sell, what the close is, which details
            to collect, and what never to say. Product facts stay in Brain.
          </p>
        </div>
        <div className="studio-field-grid">
          <div className="studio-field">
            <label htmlFor="pbTemplate">Start from template</label>
            <select
              id="pbTemplate"
              value=""
              onChange={(e) => e.target.value && onApplyTemplate(e.target.value)}
            >
              <option value="">Choose a template…</option>
              {Object.entries(PLAYBOOK_TEMPLATES).map(([id, t]) => (
                <option key={id} value={id}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="studio-field-hint">
              Replaces the playbook and sets Booking policy outcome. Everything stays editable.
            </p>
          </div>
          <div className="studio-field">
            <label>Status</label>
            <p className="studio-field-hint" style={{ marginTop: 0 }}>
              {derived
                ? 'Derived from Booking policy (not saved yet). Edit anything to make it this agent’s own.'
                : `Custom playbook (from “${playbook.templateId}”).`}
            </p>
            {!derived && (
              <button type="button" className="secondary" onClick={onReset}>
                Reset to derived
              </button>
            )}
          </div>
          <div className="studio-field">
            <label htmlFor="pbIndustry">Industry</label>
            <input
              id="pbIndustry"
              value={playbook.industry}
              onChange={(e) => set({ industry: e.target.value })}
              placeholder="e.g. Real estate"
            />
          </div>
          <div className="studio-field">
            <label htmlFor="pbCustomer">Customer is called</label>
            <input
              id="pbCustomer"
              value={playbook.customerNoun}
              onChange={(e) => set({ customerNoun: e.target.value })}
              placeholder="e.g. buyer, guest, farmer"
            />
          </div>
          <div className="studio-field">
            <label htmlFor="pbOffering">You sell</label>
            <input
              id="pbOffering"
              value={playbook.offeringNoun}
              onChange={(e) => set({ offeringNoun: e.target.value })}
              placeholder="e.g. flat or plot"
            />
          </div>
        </div>
      </section>

      <section className="studio-section" style={{ marginTop: '1.5rem' }}>
        <div className="studio-section-header">
          <h2 className="studio-section-title">Goal (the close)</h2>
          <p className="studio-section-desc">
            What a successful call ends in. The agent says this label after the save succeeds.
          </p>
        </div>
        <div className="studio-field-grid">
          <div className="studio-field">
            <label htmlFor="pbGoalLabel">Spoken label</label>
            <input
              id="pbGoalLabel"
              value={playbook.goal.label}
              onChange={(e) => setGoal({ label: e.target.value })}
              placeholder="e.g. site visit"
            />
          </div>
          <div className="studio-field">
            <label htmlFor="pbGoalSlug">Saved as (booking type)</label>
            <input
              id="pbGoalSlug"
              value={playbook.goal.slug}
              onChange={(e) => setGoal({ slug: slug(e.target.value) })}
              placeholder="e.g. site_visit"
            />
          </div>
          <div className="studio-field">
            <label htmlFor="pbGoalAlt">Other allowed types</label>
            <input
              id="pbGoalAlt"
              value={playbook.goal.alternateSlugs.join(', ')}
              onChange={(e) =>
                setGoal({
                  alternateSlugs: e.target.value
                    .split(',')
                    .map(slug)
                    .filter(Boolean),
                })
              }
              placeholder="e.g. field_visit"
            />
          </div>
          <div className="studio-field">
            <label htmlFor="pbDateMode">Date needed</label>
            <select
              id="pbDateMode"
              value={playbook.goal.dateMode}
              onChange={(e) => setGoal({ dateMode: e.target.value as PlaybookDateMode })}
            >
              {DATE_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="studio-field">
            <label htmlFor="pbLocation">Where it happens</label>
            <input
              id="pbLocation"
              value={playbook.goal.locationType}
              onChange={(e) => setGoal({ locationType: slug(e.target.value) })}
              placeholder="e.g. site, online, phone"
            />
          </div>
          <div className="studio-field studio-field--full">
            <label htmlFor="pbFields">Details to collect before save (one per line, * = required)</label>
            <textarea
              id="pbFields"
              rows={4}
              value={fieldsToLines(playbook.fields)}
              onChange={(e) => set({ fields: linesToFields(e.target.value, playbook.fields) })}
              placeholder={'Budget range *\nProperty type (BHK / plot size) *\nPreferred location'}
            />
            <p className="studio-field-hint">
              Name, phone and date are handled by Booking policy. These extra details are saved on the lead.
            </p>
          </div>
        </div>
      </section>

      <section className="studio-section" style={{ marginTop: '1.5rem' }}>
        <div className="studio-section-header">
          <h2 className="studio-section-title">Selling style</h2>
          <p className="studio-section-desc">Meanings, not scripts — the agent paraphrases every turn.</p>
        </div>
        <div className="studio-field-grid">
          {(
            [
              ['discoveryQuestions', 'Discovery questions (one per line)', 'Self-use or investment?'],
              ['qualification', 'Offer the goal when… (one per line)', 'Budget and property type are known'],
              ['mustNotSay', 'Never say or promise (one per line)', 'Possession dates not in Product Knowledge'],
            ] as const
          ).map(([key, label, placeholder]) => (
            <div className="studio-field studio-field--full" key={key}>
              <label htmlFor={`pb-${key}`}>{label}</label>
              <textarea
                id={`pb-${key}`}
                rows={3}
                value={toLines(playbook[key])}
                onChange={(e) => set({ [key]: fromLines(e.target.value) } as Partial<SalesPlaybook>)}
                placeholder={placeholder}
              />
            </div>
          ))}
          {(
            [
              ['pricingRules', 'Pricing rules', 'Say carpet vs super built-up; quote only listed prices'],
              ['handoff', 'Handoff', 'Loan / legal questions → relationship manager callback'],
              ['extraRules', 'Other selling rules', ''],
            ] as const
          ).map(([key, label, placeholder]) => (
            <div className="studio-field studio-field--full" key={key}>
              <label htmlFor={`pb-${key}`}>{label}</label>
              <textarea
                id={`pb-${key}`}
                rows={2}
                value={playbook[key]}
                onChange={(e) => set({ [key]: e.target.value } as Partial<SalesPlaybook>)}
                placeholder={placeholder}
              />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
