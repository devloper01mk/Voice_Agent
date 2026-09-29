import { mergeBookingPolicy, type BookingPolicy } from '../booking-policy.js';
import { GENERIC_PACK } from './generic.js';
import { HOTEL_STAY_PACK } from './hotel-stay.js';
import type { PackId, VerticalPack } from './types.js';

export * from './types.js';
export { isCityHotelExistenceAsk } from './hotel-stay.js';

export const VERTICAL_PACKS: Record<PackId, VerticalPack> = {
  generic: GENERIC_PACK,
  hotel_stay: HOTEL_STAY_PACK,
};

export function isPackId(raw: unknown): raw is PackId {
  return typeof raw === 'string' && raw in VERTICAL_PACKS;
}

export function getPack(id?: string | null): VerticalPack {
  return isPackId(id) ? VERTICAL_PACKS[id] : GENERIC_PACK;
}

/** `stay` outcome turns on the hotel live-inventory integration; everything else is generic. */
export function resolvePackForBooking(policyInput?: Partial<BookingPolicy> | null): VerticalPack {
  return mergeBookingPolicy(policyInput).outcome === 'stay' ? HOTEL_STAY_PACK : GENERIC_PACK;
}
