import {
  groupedSkillFields,
  getSkillFieldValue,
  setSkillFieldValue,
  RUNTIME_CODE_ITEMS,
  type SkillUiCategory,
  type SkillsConfig,
} from '@vsa/shared';
import { useMemo, useState } from 'react';
import { BookingPolicyPanel } from './BookingPolicyPanel';

const CATEGORY_TABS: { id: SkillUiCategory; label: string; icon: string; desc: string }[] = [
  {
    id: 'core',
    label: 'Core skills',
    icon: '🤝',
    desc: 'Universal call behavior — busy, DNC, privacy, angry (right brain)',
  },
  {
    id: 'sales',
    label: 'Sales skills',
    icon: '💼',
    desc: 'Discovery, objection, demo, booking policy (right brain)',
  },
  {
    id: 'runtime',
    label: 'Runtime',
    icon: '⚙️',
    desc: 'Limits, timers, contact templates (left brain)',
  },
];

function resolvePlaceholders(text: string, productName: string): string {
  return text
    .replace(/\{product_name\}/g, productName)
    .replace(/\{agent_name\}/g, 'Agent')
    .replace(/\{decision_maker\}/g, 'decision maker')
    .replace(/\{preferred_time\}/g, 'Tuesday 3pm')
    .replace(/\{email\}/g, 'user@example.com')
    .replace(/\{phone\}/g, '9876543210');
}

export function SkillsEditor({
  skills,
  productName,
  onChange,
  readOnly = true,
  bookingReadOnly,
}: {
  skills: SkillsConfig;
  productName: string;
  onChange?: (next: SkillsConfig) => void;
  readOnly?: boolean;
  /** When false, Booking policy panel is editable even if other skills stay read-only. */
  bookingReadOnly?: boolean;
}) {
  const [category, setCategory] = useState<SkillUiCategory>('core');
  const groups = useMemo(() => groupedSkillFields(category), [category]);
  const policyReadOnly = bookingReadOnly ?? readOnly;

  const updateField = (path: string, raw: string) => {
    if (readOnly) return;
    if (!onChange) return;
    const isNumeric =
      path.includes('maxRedirects') ||
      path.includes('maxCasualTurns') ||
      path.includes('Ms') ||
      path.includes('Sec') ||
      path.includes('Hours');
    const value = isNumeric ? Number(raw) || 0 : raw;
    onChange(setSkillFieldValue(skills, path, value));
  };

  return (
    <div className="skills-editor">
      <div className="skills-editor-summary">
        <div className="skills-editor-summary-card">
          <strong>System-owned skills</strong>
          <p>
            Yeh skills live prompt mein jaati hain — kaise sunna, jawab dena, de-escalate, aur kab
            close karna. Product facts alag se Brain mein rehte hain.
          </p>
        </div>
        <div className="skills-editor-summary-card">
          <strong>User input = Brain</strong>
          <p>
            Aap product ka price, features, offer, scope aur facts <code>Brain</code> tab mein
            update karte ho. Call pe agent <strong>skills + Brain</strong> dono use karta hai.
          </p>
        </div>
        <div className="skills-editor-summary-card">
          <strong>{readOnly ? 'Read-only view' : 'Editable override'}</strong>
          <p>
            {readOnly
              ? 'Yeh section explain karta hai agent ka sales engine kaise kaam karta hai.'
              : 'Advanced mode enabled — changes save hone par prompt compile hoga.'}
          </p>
        </div>
      </div>

      <div className="skills-editor-tabs">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`skills-editor-tab${category === tab.id ? ' active' : ''}`}
            onClick={() => setCategory(tab.id)}
          >
            <span className="skills-editor-tab-icon" aria-hidden>{tab.icon}</span>
            <span className="skills-editor-tab-copy">
              <strong>{tab.label}</strong>
              <small>{tab.desc}</small>
            </span>
            <span className="skills-editor-tab-arrow" aria-hidden>↗</span>
          </button>
        ))}
      </div>

      {category === 'runtime' && (
        <div className="skills-runtime-code">
          <h3>Code-enforced runtime</h3>
          <ul>
            {RUNTIME_CODE_ITEMS.map((item) => (
              <li key={item.id}>
                <span aria-hidden>{item.icon}</span>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="skills-editor-groups">
        {category === 'sales' && (
          <BookingPolicyPanel
            skills={skills}
            readOnly={policyReadOnly}
            onChange={onChange}
          />
        )}
        {[...groups.entries()].map(([groupName, fields]) => (
          <section key={groupName} className="skills-editor-group">
            <div className="skills-editor-group-head">
              <div>
                <p className="skills-editor-group-kicker">
                  {category === 'core'
                    ? 'Fixed behavior'
                    : category === 'sales'
                      ? 'Selling pattern'
                      : 'Runtime setting'}
                </p>
                <h3>{groupName}</h3>
              </div>
              <span className="skills-editor-count">{fields.length} items</span>
            </div>
            <div className="skills-editor-fields">
              {fields.map((field) => {
                const raw = getSkillFieldValue(skills, field.path);
                const display =
                  typeof raw === 'number'
                    ? String(raw)
                    : raw != null && raw !== ''
                      ? String(raw)
                      : field.path === 'runtime.leadMemoryRetentionHours'
                        ? '48'
                        : '';
                const isNumeric =
                  field.path.includes('maxRedirects') ||
                  field.path.includes('maxCasualTurns') ||
                  field.path.includes('Ms') ||
                  field.path.includes('Sec') ||
                  field.path.includes('Hours');
                const optionLabel =
                  field.options?.find((o) => String(o.value) === display)?.label ?? display;

                return (
                  <div
                    key={field.path}
                    className={`skills-editor-field${readOnly ? ' is-readonly' : ''}`}
                  >
                    <div className="skills-editor-field-head">
                      <label htmlFor={field.path}>{field.label}</label>
                      {readOnly && <span className="skills-editor-chip">Default</span>}
                    </div>
                    {readOnly ? (
                      <div
                        id={field.path}
                        className={`skills-editor-value${isNumeric ? ' is-numeric' : ''}`}
                      >
                        {field.options ? optionLabel || 'Not configured' : display || 'Not configured'}
                      </div>
                    ) : field.options ? (
                      <select
                        id={field.path}
                        value={display}
                        disabled={readOnly}
                        onChange={(e) => updateField(field.path, e.target.value)}
                      >
                        {field.options.map((opt) => (
                          <option key={String(opt.value)} value={String(opt.value)}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : field.multiline ? (
                      <textarea
                        id={field.path}
                        rows={2}
                        value={display}
                        readOnly={readOnly}
                        onChange={(e) => updateField(field.path, e.target.value)}
                        placeholder={field.placeholder}
                      />
                    ) : (
                      <input
                        id={field.path}
                        type={isNumeric ? 'number' : 'text'}
                        value={display}
                        readOnly={readOnly}
                        onChange={(e) => updateField(field.path, e.target.value)}
                      />
                    )}
                    {field.hint && <p className="studio-field-hint">{field.hint}</p>}
                    {!isNumeric && !field.options && display && (
                      <p className="skills-editor-preview muted">
                        Preview: {resolvePlaceholders(display, productName)}
                      </p>
                    )}
                    {readOnly && (
                      <p className="skills-editor-lock muted">Fixed sales engine default</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
