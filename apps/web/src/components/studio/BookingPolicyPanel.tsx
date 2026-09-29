import {
  mergeBookingPolicy,
  applyBookingPolicyTemplate,
  BOOKING_POLICY_TEMPLATES,
  vocabularyForOutcome,
  type SkillsConfig,
  type BookingPolicy,
  type BookingRequiredField,
  type BookingDiscussGate,
  type BookingOutcome,
  type BookingPolicyTemplateId,
  type BookingLocationType,
} from '@vsa/shared';

const REQUIRED_FIELD_OPTIONS: { id: BookingRequiredField; label: string }[] = [
  { id: 'preferred_time', label: 'Date / time' },
  { id: 'party_size', label: 'Guests / party size' },
  { id: 'name', label: 'Name' },
  { id: 'phone', label: 'Phone' },
  { id: 'email', label: 'Email' },
];

const DISCUSS_OPTIONS: { id: BookingDiscussGate; label: string }[] = [
  { id: 'payment', label: 'Payment / advance' },
  { id: 'cancellation', label: 'Cancellation policy' },
  { id: 'id_proof', label: 'ID proof' },
  { id: 'budget', label: 'Budget fit' },
];

const OUTCOME_OPTIONS: { id: BookingOutcome; label: string }[] = [
  { id: 'demo', label: 'Demo' },
  { id: 'visit', label: 'Visit / appointment' },
  { id: 'stay', label: 'Stay / hotel booking' },
  { id: 'callback', label: 'Callback' },
  { id: 'lead_only', label: 'Lead only' },
];

const LOCATION_OPTIONS: { id: BookingLocationType; label: string }[] = [
  { id: 'hotel', label: 'Hotel / property' },
  { id: 'showroom', label: 'Showroom' },
  { id: 'home', label: 'Home' },
  { id: 'online', label: 'Online' },
];

function toggleList<T extends string>(list: T[], id: T, on: boolean): T[] {
  if (on) return list.includes(id) ? list : [...list, id];
  return list.filter((x) => x !== id);
}

export function BookingPolicyPanel({
  skills,
  readOnly,
  onChange,
}: {
  skills: SkillsConfig;
  readOnly: boolean;
  onChange?: (next: SkillsConfig) => void;
}) {
  const booking = mergeBookingPolicy(skills.booking);

  const patchBooking = (next: BookingPolicy) => {
    if (readOnly || !onChange) return;
    onChange({ ...skills, booking: next });
  };

  return (
    <section className="skills-editor-group booking-policy-panel">
      <div className="skills-editor-group-head">
        <div>
          <p className="skills-editor-group-kicker">Per-agent process</p>
          <h3>Booking policy</h3>
        </div>
      </div>
      <p className="studio-field-hint" style={{ marginBottom: 12 }}>
        Brain = product facts. Yeh policy = kya save karna hai, kya bolna hai after confirm, aur
        kaunse booking types is agent ke liye allowed hain — code mein hardcode nahi.
      </p>

      <div className="skills-editor-fields">
        <div className={`skills-editor-field${readOnly ? ' is-readonly' : ''}`}>
          <label htmlFor="booking-template">Template</label>
          <select
            id="booking-template"
            disabled={readOnly}
            value={booking.templateId === 'custom' ? 'custom' : booking.templateId}
            onChange={(e) => {
              const id = e.target.value as BookingPolicyTemplateId;
              if (id === 'custom') {
                patchBooking({ ...booking, templateId: 'custom' });
                return;
              }
              patchBooking(applyBookingPolicyTemplate(id));
            }}
          >
            {(Object.keys(BOOKING_POLICY_TEMPLATES) as Array<keyof typeof BOOKING_POLICY_TEMPLATES>).map(
              (id) => (
                <option key={id} value={id}>
                  {BOOKING_POLICY_TEMPLATES[id].label}
                </option>
              ),
            )}
            <option value="custom">Custom</option>
          </select>
          {booking.templateId !== 'custom' && BOOKING_POLICY_TEMPLATES[booking.templateId] && (
            <p className="studio-field-hint">
              {BOOKING_POLICY_TEMPLATES[booking.templateId].description}
            </p>
          )}
        </div>

        <div className={`skills-editor-field${readOnly ? ' is-readonly' : ''}`}>
          <label htmlFor="booking-outcome">Save outcome</label>
          <select
            id="booking-outcome"
            disabled={readOnly}
            value={booking.outcome}
            onChange={(e) => {
              const outcome = e.target.value as BookingOutcome;
              const vocab = vocabularyForOutcome(outcome);
              patchBooking({
                ...booking,
                templateId: 'custom',
                outcome,
                ...vocab,
              });
            }}
          >
            {OUTCOME_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className={`skills-editor-field${readOnly ? ' is-readonly' : ''}`}>
          <label htmlFor="booking-type">Default booking type (slug)</label>
          {readOnly ? (
            <div className="skills-editor-value">{booking.bookingType}</div>
          ) : (
            <input
              id="booking-type"
              type="text"
              value={booking.bookingType}
              onChange={(e) =>
                patchBooking({
                  ...booking,
                  templateId: 'custom',
                  bookingType: e.target.value,
                })
              }
              placeholder="e.g. stay, demo, clinic_visit"
            />
          )}
          <p className="studio-field-hint">Stored on the lead — lowercase slug, e.g. stay</p>
        </div>

        <div className={`skills-editor-field${readOnly ? ' is-readonly' : ''}`}>
          <label htmlFor="booking-speak-as">Say after confirm</label>
          {readOnly ? (
            <div className="skills-editor-value">{booking.speakAs}</div>
          ) : (
            <input
              id="booking-speak-as"
              type="text"
              value={booking.speakAs}
              onChange={(e) =>
                patchBooking({
                  ...booking,
                  templateId: 'custom',
                  speakAs: e.target.value,
                })
              }
              placeholder='e.g. hotel stay booking'
            />
          )}
          <p className="studio-field-hint">
            Agent must say this after save — not “showroom visit” unless you set that here
          </p>
        </div>

        <div className={`skills-editor-field${readOnly ? ' is-readonly' : ''}`}>
          <label htmlFor="booking-allowed">Allowed booking types</label>
          {readOnly ? (
            <div className="skills-editor-value">{booking.allowedBookingTypes.join(', ')}</div>
          ) : (
            <input
              id="booking-allowed"
              type="text"
              value={booking.allowedBookingTypes.join(', ')}
              onChange={(e) =>
                patchBooking({
                  ...booking,
                  templateId: 'custom',
                  allowedBookingTypes: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="stay  OR  showroom_visit, test_drive"
            />
          )}
          <p className="studio-field-hint">
            Comma-separated. Tool only offers these for this agent (hotel → stay only)
          </p>
        </div>

        <div className={`skills-editor-field${readOnly ? ' is-readonly' : ''}`}>
          <label htmlFor="booking-location">Location type</label>
          <select
            id="booking-location"
            disabled={readOnly}
            value={booking.locationType}
            onChange={(e) =>
              patchBooking({
                ...booking,
                templateId: 'custom',
                locationType: e.target.value as BookingLocationType,
              })
            }
          >
            {LOCATION_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
            {!LOCATION_OPTIONS.some((o) => o.id === booking.locationType) && (
              <option value={booking.locationType}>{booking.locationType} (from playbook)</option>
            )}
          </select>
        </div>

        <div className={`skills-editor-field${readOnly ? ' is-readonly' : ''}`}>
          <label>Required before save</label>
          <div className="booking-policy-checks">
            {REQUIRED_FIELD_OPTIONS.map((f) => (
              <label key={f.id} className="booking-policy-check">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={booking.requiredFields.includes(f.id)}
                  onChange={(e) =>
                    patchBooking({
                      ...booking,
                      templateId: 'custom',
                      requiredFields: toggleList(booking.requiredFields, f.id, e.target.checked),
                    })
                  }
                />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        <div className={`skills-editor-field${readOnly ? ' is-readonly' : ''}`}>
          <label>Discuss before save (from Brain)</label>
          <div className="booking-policy-checks">
            {DISCUSS_OPTIONS.map((f) => (
              <label key={f.id} className="booking-policy-check">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={booking.discussBeforeSave.includes(f.id)}
                  onChange={(e) =>
                    patchBooking({
                      ...booking,
                      templateId: 'custom',
                      discussBeforeSave: toggleList(
                        booking.discussBeforeSave,
                        f.id,
                        e.target.checked,
                      ),
                    })
                  }
                />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        <div className={`skills-editor-field${readOnly ? ' is-readonly' : ''}`}>
          <label className="booking-policy-check">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={booking.askEmail}
              onChange={(e) =>
                patchBooking({
                  ...booking,
                  templateId: 'custom',
                  askEmail: e.target.checked,
                })
              }
            />
            Ask for email before save
          </label>
        </div>

        <div className={`skills-editor-field${readOnly ? ' is-readonly' : ''}`}>
          <label htmlFor="booking-notes">Extra policy notes</label>
          {readOnly ? (
            <div className="skills-editor-value">{booking.notes || 'None'}</div>
          ) : (
            <textarea
              id="booking-notes"
              rows={2}
              value={booking.notes}
              onChange={(e) =>
                patchBooking({
                  ...booking,
                  templateId: 'custom',
                  notes: e.target.value,
                })
              }
              placeholder="Optional extra rules for this agent…"
            />
          )}
        </div>
      </div>
    </section>
  );
}
