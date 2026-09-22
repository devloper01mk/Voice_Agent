import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cityQueryCandidates,
  hotelNameQueryCandidates,
  summarizeNexoraHotelFactsPayload,
  compactHotelFactsForLlm,
  evaluateStayInventoryForBooking,
  resolveStayInventoryQuery,
  resolveHotelMatchForApi,
  buildNexoraHotelMatch,
  toNexoraMatchArray,
  extractKnownHotelCityFromText,
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
    assert.match(summary.speak_now, /Hostel|Resort/i);
    assert.match(summary.speak_now, /Kaunsi/i);
    // Multi-property ask must NOT dump Hostel dorm prices
    assert.doesNotMatch(summary.speak_now, /699|4199|from \d/);

    const compact = compactHotelFactsForLlm(summary);
    assert.equal(compact.ok, true);
    assert.equal(compact.discount_pct, 10);
    assert.ok(Array.isArray(compact.other_properties));
    assert.equal(compact.rooms, undefined);
    assert.match(String(compact.rule), /MULTI-PROPERTY/i);
  });

  it('returns error when no matches', () => {
    const summary = summarizeNexoraHotelFactsPayload({ matches: [] });
    assert.equal(summary.ok, false);
  });

  it('prefers Resort + Suite over Hostel dorms when booking hints are set', () => {
    const payload = {
      matches: [
        {
          identity: {
            city: 'Rishikesh',
            hotel_id: 'MOU-0006',
            hotel_name: 'Moustache Rishikesh',
            property_type: 'Hostel',
            state: 'Uttarakhand',
          },
          related: [
            {
              identity: { room_id: 'R-06-01', room_name: '6 Bed Mixed Dorm' },
              facts: { available_rooms_beds: '6', price_per_night: '699' },
            },
            {
              identity: { room_id: 'R-06-02', room_name: '4 Bed Mixed Dorm' },
              facts: { available_rooms_beds: '19', price_per_night: '999' },
            },
            {
              identity: { room_id: 'R-06-03', room_name: 'Female Dorm' },
              facts: { available_rooms_beds: '16', price_per_night: '749' },
            },
            {
              identity: { room_id: 'R-06-04', room_name: 'Private Double Room' },
              facts: { available_rooms_beds: '1', price_per_night: '2799' },
            },
          ],
        },
        {
          identity: {
            city: 'Rishikesh',
            hotel_id: 'MOU-0057',
            hotel_name: 'Moustache Rishikesh',
            property_type: 'Resort',
            state: 'Uttarakhand',
          },
          related: [
            {
              identity: { room_id: 'R-57-01', room_name: 'Garden View Room' },
              facts: { available_rooms_beds: '2', price_per_night: '4199' },
            },
            {
              identity: { room_id: 'R-57-03', room_name: 'Premium Suite' },
              facts: { available_rooms_beds: '1', price_per_night: '6999' },
            },
          ],
        },
      ],
    };

    const without = summarizeNexoraHotelFactsPayload(payload);
    assert.equal(without.ok, true);
    if (without.ok) {
      // Hostel has more room types → wins without prefer
      assert.ok(without.rooms.some((r) => /dorm/i.test(r.room_name)));
    }

    const withPrefer = summarizeNexoraHotelFactsPayload(payload, {
      hotel: 'Moustache Rishikesh Resort',
      room: 'Suite',
    });
    assert.equal(withPrefer.ok, true);
    if (!withPrefer.ok) return;
    assert.ok(withPrefer.rooms.some((r) => /suite/i.test(r.room_name)));
    assert.equal(withPrefer.property_type, 'Resort');

    const gate = evaluateStayInventoryForBooking(withPrefer, { room_name: 'Suite' });
    assert.equal(gate.ok, true);
    if (!gate.ok) return;
    assert.match(gate.room?.name ?? '', /Premium Suite/i);

    // Prefer lock: speak Resort rooms, not multi-property ask
    assert.match(withPrefer.speak_now, /Suite|Garden|Resort/i);
    assert.doesNotMatch(withPrefer.speak_now, /Kaunsi/i);
    const compactPrefer = compactHotelFactsForLlm(withPrefer);
    assert.ok(Array.isArray(compactPrefer.rooms));
    assert.ok((compactPrefer.rooms as unknown[]).length > 0);
  });

  it('room prefer hard-locks even when Hostel has more room types', () => {
    const payload = {
      matches: [
        {
          identity: {
            city: 'Rishikesh',
            hotel_id: 'MOU-0006',
            hotel_name: 'Moustache Rishikesh',
            property_type: 'Hostel',
          },
          related: [
            {
              identity: { room_id: 'R-06-01', room_name: '6 Bed Mixed Dorm' },
              facts: { available_rooms_beds: '6', price_per_night: '699' },
            },
            {
              identity: { room_id: 'R-06-02', room_name: '4 Bed Mixed Dorm' },
              facts: { available_rooms_beds: '19', price_per_night: '999' },
            },
            {
              identity: { room_id: 'R-06-03', room_name: 'Female Dorm' },
              facts: { available_rooms_beds: '16', price_per_night: '749' },
            },
            {
              identity: { room_id: 'R-06-04', room_name: 'Private Double Room' },
              facts: { available_rooms_beds: '1', price_per_night: '2799' },
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
              identity: { room_id: 'R-57-03', room_name: 'Premium Suite' },
              facts: { available_rooms_beds: '1', price_per_night: '6999' },
            },
          ],
        },
      ],
    };
    const locked = summarizeNexoraHotelFactsPayload(payload, { room: 'Suite' });
    assert.equal(locked.ok, true);
    if (!locked.ok) return;
    assert.equal(locked.property_type, 'Resort');
    assert.ok(locked.rooms.some((r) => /suite/i.test(r.room_name)));
    assert.ok(!locked.rooms.some((r) => /dorm/i.test(r.room_name)));
  });

  it('prefers a later match with real inventory over an early stub related row', () => {
    const summary = summarizeNexoraHotelFactsPayload({
      matches: [
        {
          identity: {
            city: 'Rishikesh',
            hotel_name: 'Moustache Rishikesh',
            state: 'Uttarakhand',
          },
          related: [
            {
              identity: { room_name: 'Private Double Room' },
              facts: { room_name: 'Private Double Room' },
            },
          ],
        },
        {
          identity: {
            city: 'Rishikesh',
            hotel_id: 'MOU-0006',
            hotel_name: 'Moustache Rishikesh',
            property_type: 'Hostel',
            state: 'Uttarakhand',
          },
          related: [
            {
              identity: {
                room_id: 'R-06-01',
                room_name: '6 Bed Mixed Dorm',
                room_type: 'Dormitory',
              },
              facts: {
                available_rooms_beds: '6',
                price_per_night: '699',
                discount: '10',
                check_in: '13:00',
                check_out: '11:00',
              },
            },
            {
              identity: {
                room_id: 'R-06-02',
                room_name: 'Private Double Room',
                room_type: 'Private',
              },
              facts: {
                available_rooms_beds: '3',
                price_per_night: '2499',
                discount: '10',
              },
            },
          ],
        },
      ],
    });
    assert.equal(summary.ok, true);
    if (!summary.ok) return;
    assert.equal(summary.rooms.length, 2);
    assert.equal(summary.rooms[0]?.price_per_night, 699);
    assert.match(summary.speak_now, /699|2499/);
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
    assert.match(String(compact.rule), /no match/i);
    assert.doesNotMatch(String(compact.rule), /FALLBACK/i);
  });
});

describe('evaluateStayInventoryForBooking', () => {
  const rooms = [
    {
      room_id: '1',
      room_name: 'Garden View Room',
      room_type: 'Private',
      available_beds: 2,
      price_per_night: 2499,
      discount_pct: 10,
    },
    {
      room_id: '2',
      room_name: 'Mountain View Room',
      room_type: 'Private',
      available_beds: 0,
      price_per_night: 5499,
      discount_pct: 20,
    },
  ];

  const okPayload = {
    ok: true as const,
    hotel_name: 'Demo Stay',
    city: 'Jaipur',
    policies: {},
    rooms,
    spoken_hint: 'hint',
    speak_now: 'speak',
  };

  it('blocks when the chosen room is sold out and offers alternatives', () => {
    const gate = evaluateStayInventoryForBooking(okPayload, {
      room_name: 'Mountain View',
    });
    assert.equal(gate.ok, false);
    if (gate.ok) return;
    assert.match(gate.error, /sold out/i);
    assert.equal(gate.inventory_stale, true);
    assert.equal(gate.alternatives?.length, 1);
    assert.equal(gate.alternatives?.[0]?.name, 'Garden View Room');
  });

  it('allows when the chosen room still has beds', () => {
    const gate = evaluateStayInventoryForBooking(okPayload, {
      room_name: 'Garden View Room',
    });
    assert.equal(gate.ok, true);
    if (!gate.ok) return;
    assert.equal(gate.inventory_verified, true);
    assert.equal(gate.room?.name, 'Garden View Room');
    assert.equal(gate.room?.free, 2);
  });

  it('blocks when property has zero free beds', () => {
    const gate = evaluateStayInventoryForBooking({
      ...okPayload,
      rooms: rooms.map((r) => ({ ...r, available_beds: 0 })),
    });
    assert.equal(gate.ok, false);
    if (gate.ok) return;
    assert.match(gate.error, /full/i);
  });

  it('soft-allows when live API is down (fallback_to_brain)', () => {
    const gate = evaluateStayInventoryForBooking({
      ok: false,
      error: 'network',
      fallback_to_brain: true,
    });
    assert.equal(gate.ok, true);
    if (!gate.ok) return;
    assert.equal(gate.inventory_verified, false);
  });
});

describe('resolveStayInventoryQuery', () => {
  it('prefers city then hotel then notes label', () => {
    assert.equal(resolveStayInventoryQuery({ city: 'Jaipur', hotel_name: 'X' }), 'Jaipur');
    assert.equal(resolveStayInventoryQuery({ hotel_name: 'Brand Jaipur' }), 'Brand Jaipur');
    assert.equal(
      resolveStayInventoryQuery({ notes: 'city: Pelling | Deluxe' }),
      'Pelling',
    );
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

describe('extractKnownHotelCityFromText', () => {
  it('maps Devanagari and Latin Agra mentions to English Agra', () => {
    assert.equal(extractKnownHotelCityFromText('मैंने आगरा खोला।'), 'Agra');
    assert.equal(extractKnownHotelCityFromText('Agra mein hotel?'), 'Agra');
    assert.equal(extractKnownHotelCityFromText('hello only'), undefined);
  });

  it('covers every live Moustache city (Latin + Devanagari)', () => {
    const cases: Array<[string, string]> = [
      ['Shimla mein Moustache hai?', 'Shimla'],
      ['शिमला में होटल', 'Shimla'],
      ['Kasol jaana hai', 'Kasol'],
      ['Jibhi ya Tirthan?', 'Jibhi'],
      ['Tirthan Valley me cabin', 'Tirthan Valley'],
      ['Mcleodganj hostel', 'Mcleodganj'],
      ['मैक्लोडगंज में', 'Mcleodganj'],
      ['Dharamkot', 'Dharamkot'],
      ['Bir Billing paragliding ke baad stay', 'Bir'],
      ['Haridwar mein property?', 'Haridwar'],
      ['हरिद्वार', 'Haridwar'],
      ['Bhimtal lake side', 'Bhimtal'],
      ['Kausani', 'Kausani'],
      ['Almora', 'Almora'],
      ['Mount Abu mein resort', 'Mount Abu'],
      ['माउंट आबू', 'Mount Abu'],
      ['Munnar Kerala', 'Munnar'],
      ['Alleppey houseboat ke paas hotel', 'Alleppey'],
      ['Jagannath Puri mein', 'Puri'],
      ['Puri mein hotel hai?', 'Puri'],
      ['पुरी में होटल', 'Puri'],
      ['Khajuraho', 'Khajuraho'],
      ['Delhi mein Moustache hai?', 'Delhi'],
      ['दिल्ली में', 'Delhi'],
    ];
    for (const [text, city] of cases) {
      assert.equal(extractKnownHotelCityFromText(text), city, text);
    }
  });

  it('does not treat Hinglish "puri" (full) as the city Puri', () => {
    assert.equal(extractKnownHotelCityFromText('puri details WhatsApp kar do'), undefined);
    assert.equal(extractKnownHotelCityFromText('puri jaankari chahiye'), undefined);
    assert.equal(extractKnownHotelCityFromText('पूरी जानकारी दो'), undefined);
  });
});

describe('buildNexoraHotelMatch / resolveHotelMatchForApi', () => {
  it('sends city-only as array and never empty state', () => {
    const resolved = resolveHotelMatchForApi({ city: 'Rishikesh' });
    assert.equal(resolved.city, 'Rishikesh');
    assert.equal(resolved.state, undefined);
    assert.deepEqual(buildNexoraHotelMatch({ city: resolved.city }), {
      city: ['Rishikesh'],
    });
  });

  it('sends state-only as array', () => {
    const resolved = resolveHotelMatchForApi({ state: 'Uttarakhand' });
    assert.equal(resolved.city, '');
    assert.equal(resolved.state, 'Uttarakhand');
    assert.deepEqual(buildNexoraHotelMatch({ state: resolved.state }), {
      state: ['Uttarakhand'],
    });
  });

  it('sends both city and state as arrays when both asked', () => {
    const resolved = resolveHotelMatchForApi({
      city: 'Rishikesh',
      state: 'Uttarakhand',
    });
    assert.deepEqual(
      buildNexoraHotelMatch({ city: resolved.city, state: resolved.state }),
      { city: ['Rishikesh'], state: ['Uttarakhand'] },
    );
  });

  it('drops empty strings from match arrays', () => {
    assert.deepEqual(buildNexoraHotelMatch({ city: 'Jaipur', state: ['', ''] }), {
      city: ['Jaipur'],
    });
    assert.equal(toNexoraMatchArray(['', '  ']), undefined);
  });
});
