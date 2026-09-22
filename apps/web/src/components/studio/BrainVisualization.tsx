import {
  BRAIN_MAP,
  RUNTIME_CODE_ITEMS,
  brainItemsByHemisphere,
  type BrainMapItem,
} from '@vsa/shared';

function HemisphereColumn({
  title,
  subtitle,
  hemisphere,
  items,
  accentClass,
}: {
  title: string;
  subtitle: string;
  hemisphere: 'left' | 'right';
  items: BrainMapItem[];
  accentClass: string;
}) {
  return (
    <div className={`brain-hemisphere brain-hemisphere--${hemisphere}`}>
      <div className={`brain-hemisphere-head ${accentClass}`}>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <ul className="brain-hemisphere-list">
        {items.map((item) => (
          <li key={item.id} className="brain-map-item">
            <span className="brain-map-icon" aria-hidden>
              {item.icon}
            </span>
            <div>
              <strong>{item.label}</strong>
              <p>{item.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BrainVisualization() {
  const leftItems = brainItemsByHemisphere('left');
  const rightItems = brainItemsByHemisphere('right');

  return (
    <section className="brain-viz">
      <div className="brain-viz-header">
        <h2 className="studio-section-title">Agent brain map</h2>
        <p className="studio-section-desc">
          Left brain = facts, rules, engine. Right brain = human tone and conversation skills.
        </p>
      </div>

      <div className="brain-viz-diagram" aria-hidden>
        <svg viewBox="0 0 320 200" className="brain-viz-svg" role="img">
          <title>Stylized brain — left and right hemispheres</title>
          <path
            d="M160 24 C100 24 56 68 56 118 C56 158 88 182 128 186 C140 168 152 168 160 168 C168 168 180 168 192 186 C232 182 264 158 264 118 C264 68 220 24 160 24 Z"
            fill="var(--brain-fill, #f4f0ff)"
            stroke="var(--brain-stroke, #c4b5fd)"
            strokeWidth="2"
          />
          <line x1="160" y1="32" x2="160" y2="178" stroke="#a78bfa" strokeWidth="2" strokeDasharray="4 3" />
          <text x="108" y="108" textAnchor="middle" fontSize="13" fill="#5b21b6" fontWeight="600">
            LEFT
          </text>
          <text x="108" y="124" textAnchor="middle" fontSize="10" fill="#6d28d9">
            Logic
          </text>
          <text x="212" y="108" textAnchor="middle" fontSize="13" fill="#9d174d" fontWeight="600">
            RIGHT
          </text>
          <text x="212" y="124" textAnchor="middle" fontSize="10" fill="#be185d">
            Human
          </text>
        </svg>
      </div>

      <div className="brain-viz-columns">
        <HemisphereColumn
          title="Left brain"
          subtitle="Knowledge · Rules · Runtime · Records"
          hemisphere="left"
          items={leftItems}
          accentClass="brain-accent--left"
        />
        <HemisphereColumn
          title="Right brain"
          subtitle="Skills · Persona · Tone · Improvisation"
          hemisphere="right"
          items={rightItems}
          accentClass="brain-accent--right"
        />
      </div>

      <div className="brain-runtime-panel">
        <h3>Runtime engine (code-enforced)</h3>
        <p className="studio-section-desc">
          These run in the voice worker — not editable as text, but shown here for transparency.
        </p>
        <ul className="brain-runtime-list">
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

      <p className="brain-viz-footnote muted">
        {BRAIN_MAP.length} mapped areas · Left {leftItems.length} · Right {rightItems.length} · Runtime{' '}
        {RUNTIME_CODE_ITEMS.length}
      </p>
    </section>
  );
}
