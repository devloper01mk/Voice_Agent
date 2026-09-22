import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cityQueryCandidates,
  hotelNameQueryCandidates,
  summarizeNexoraHotelFactsPayload,
  compactHotelFactsForLlm,
} from './nexora-hotel-facts.js';

describe('summarizeNexoraHotelFactsPayload', () => {
  it('dedupes related rows by room_id and picks mode price + max beds', () => {
    const summary = summarizeNexoraHotelFactsPayload({
      latency_ms: 300,
      matches: [
        {
          identity: {
            hotel_name: 'Sample Jaipur Hostel',
            hotel_id: 'H-0001',
            property_type: 'Hostel',
            city: 'Jaipur',
            state: 'Rajasthan',
            Address: 'MI Road, Jaipur',
            'Check-in': '12:00 PM',
            'Check-out': '11:00 AM',
            cancellation_policy: 'Free cancel 24h before check-in',
            house_rules: 'No parties after 10 PM',
            payment_policy: '20% advance to confirm',
          },
          related: [
            {
              identity: { room_id: 'R-01-01', room_name: '6 Bed Mixed Dorm', room_type: 'Dormitory' },
              facts: {
                available_rooms_beds: '7',
                price_per_night: '899',
                discount_pct: '5',
                'Discount (%)': '5',
              },
            },
            {
              identity: { room_id: 'R-01-01', room_name: '6 Bed Mixed Dorm' },
              facts: {
                available_rooms_beds: '11',
                price_per_night: '599',
                'Discount (%)': '5',
              },
            },
            {
              identity: { room_id: 'R-01-01', room_name: '6 Bed Mixed Dorm' },
              facts: {
                available_rooms_beds: '4',
                price_per_night: '899',
                'Discount (%)': '5',
              },
            },
            {
              identity: { room_id: 'R-01-04', room_name: 'Private Double Room', room_type: 'Private' },
              facts: {
                available_rooms_beds: '3',
                price_per_night: '2999',
                'Discount (%)': '5',
              },
            },
          ],
        },
      ],
    });

    assert.equal(summary.ok, true);
    if (!summary.ok) return;
    assert.equal(summary.hotel_name, 'Sample Jaipur Hostel');
    assert.equal(summary.address, 'MI Road, Jaipur');
    assert.equal(summary.policies.check_in, '12:00 PM');
    assert.equal(summary.policies.check_out, '11:00 AM');
    assert.match(summary.policies.cancellation ?? '', /Free cancel/i);
    assert.match(summary.policies.house_rules ?? '', /No parties/i);
    assert.match(summary.policies.payment ?? '', /20%/);
    assert.equal(summary.rooms.length, 2);
    const dorm = summary.rooms.find((r) => r.room_id === 'R-01-01');
    assert.ok(dorm);
    assert.equal(dorm!.price_per_night, 899);
    assert.equal(dorm!.available_beds, 11);
    assert.equal(dorm!.room_type, 'Dormitory');
    assert.match(summary.spoken_hint, /6 Bed Mixed Dorm/i);
    assert.match(summary.spoken_hint, /Check-in\/out/i);
    assert.ok(summary.speak_now);
    assert.match(summary.speak_now, /899|2999/);

    const compact = compactHotelFactsForLlm(summary);
    assert.equal(compact.ok, true);
    assert.ok((compact.policies as Record<string, string>).check_in);
    assert.equal(compact.spoken_to_caller, true);
  });

  it('parses discount + check_in from related facts and multi-property cities', () => {
    const summary = summarizeNexoraHotelFactsPayload({
      matches: [
        {
          identity: {
            city: 'Rishikesh',
            hotel_id: 'MOU-0006',
            hotel_name: 'Moustache Rishikesh',
            property_type: 'Hostel',
            state: 'Uttarakhand',
          },
          facts: {},
          related: [
            {
              identity: { room_id: 'R-06-01', room_name: '6 Bed Mixed Dorm', room_type: 'Dormitory' },
              facts: {
                available_rooms_beds: '6',
                price_per_night: '699',
                discount: '10',
                check_in: '13:00',
                check_out: '11:00',
              },
            },
            {
              identity: { room_id: 'R-06-02', room_name: '4 Bed Mixed Dorm', room_type: 'Dormitory' },
              facts: {
                available_rooms_beds: '19',
                price_per_night: '999',
                discount: '10',
                check_in: '13:00',
                check_out: '11:00',
              },
            },
          ],
        },
        {
          identity: {
            city: 'Rishikesh',
            hotel_id: 'MOU-0057',
            hotel_name: 'Moustache Rishikesh',
            property_type: 'Resort',
          },
          related: [
            {
              identity: { room_id: 'R-57-01', room_name: 'Garden View Room' },
              facts: {
                available_rooms_beds: '2',
                price_per_night: '4199',
                discount: '15',
              },
            },
          ],
        },
      ],
    });

    assert.equal(summary.ok, true);
    if (!summary.ok) return;
    assert.equal(summary.rooms[0]?.discount_pct, 10);
    assert.equal(summary.policies.check_in, '13:00');
    assert.equal(summary.policies.check_out, '11:00');
    assert.equal(summary.other_properties?.length, 1);
    assert.match(summary.speak_now, /Rishikesh/i);
    assert.match(summary.speak_now, /properties|Hostel|Resort/i);

    const compact = compactHotelFactsForLlm(summary);
    assert.equal(compact.ok, true);
    assert.equal(compact.discount_pct, 10);
    assert.ok(Array.isArray(compact.other_properties));
  });

  it('returns error when no matches', () => {
    const summary = summarizeNexoraHotelFactsPayload({ matches: [] });
    assert.equal(summary.ok, false);
  });

  it('marks inventory available and sold-out rooms separately', () => {
    const summary = summarizeNexoraHotelFactsPayload({
      matches: [
        {
          identity: { hotel_name: 'Hill Property', city: 'Pelling', state: 'Sikkim' },
          related: [
            {
              identity: { room_id: 'R-55-01', room_name: 'Garden View Room', room_type: 'Private' },
              facts: { available_rooms_beds: '8', price_per_night: '4299', discount: '20' },
            },
            {
              identity: { room_id: 'R-55-02', room_name: 'Mountain/Lake View Room', room_type: 'Private' },
              facts: { available_rooms_beds: '0', price_per_night: '5499', discount: '20' },
            },
          ],
        },
      ],
    });
    assert.equal(summary.ok, true);
    if (!summary.ok) return;
    assert.match(summary.spoken_hint, /available/i);
    assert.match(summary.spoken_hint, /Garden View Room/i);
    assert.match(summary.spoken_hint, /Sold out: Mountain\/Lake View Room/i);
    assert.match(summary.spoken_hint, /Policy fields not in live payload/i);
  });
});

describe('compactHotelFactsForLlm fallback', () => {
  it('flags infra failures so the agent can answer from Product Knowledge', () => {
    const compact = compactHotelFactsForLlm({
      ok: false,
      error: 'Hotel facts request failed: fetch failed',
      hint: 'Live inventory unavailable.',
      fallback_to_brain: true,
    });
    assert.equal(compact.ok, false);
    assert.equal(compact.fallback_to_brain, true);
    assert.equal(compact.spoken_to_caller, false);
    assert.match(String(compact.say), /Product Knowledge/i);
    assert.match(String(compact.rule), /FALLBACK/i);
  });

  it('does not enable brain fallback for a plain no-match', () => {
    const compact = compactHotelFactsForLlm({
      ok: false,
      error: 'No hotel match',
      hint: 'Ask the caller to clarify the city.',
    });
    assert.equal(compact.ok, false);
    assert.equal(compact.fallback_to_brain, false);
    // Plain no-match must NOT carry the FALLBACK rule (that would let the agent answer from brain).
    assert.doesNotMatch(String(compact.rule ?? ''), /FALLBACK/i);
    assert.match(String(compact.rule ?? ''), /no match/i);
  });
});

describe('cityQueryCandidates', () => {
  it('maps branded names and regions to city tokens without brand hardcode', () => {
    const sikkim = cityQueryCandidates('Brand Sikkim');
    assert.ok(sikkim.includes('Pelling'));
    assert.ok(cityQueryCandidates('AnyBrand Jaipur').includes('Jaipur'));
    assert.ok(cityQueryCandidates('Dehradun').includes('Dehradun'));
    assert.ok(hotelNameQueryCandidates('Brand Sikkim').length >= 1);
  });
});
