import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyBookingPolicyTemplate,
  buildBookingPolicyPrompt,
  buildCaptureDemoLeadToolDescription,
  mergeBookingPolicy,
  mergeSkillsConfig,
  missingBookingDiscussGates,
  bookingDiscussGateRejection,
  resolveBookingType,
  bookingSavedConfirmMessage,
} from './index.js';

describe('booking policy', () => {
  it('hotel template requires payment discuss', () => {
    const policy = applyBookingPolicyTemplate('hotel_stay');
    assert.equal(policy.outcome, 'stay');
    assert.ok(policy.discussBeforeSave.includes('payment'));
    assert.ok(policy.requiredFields.includes('party_size'));
    const prompt = buildBookingPolicyPrompt(policy);
    assert.match(prompt, /payment/i);
    assert.match(prompt, /party_size|guests/i);
    assert.match(prompt, /save gates only/i);
    assert.match(prompt, /Do NOT.*bring up payment/i);
  });

  it('crm demo template has no payment gate', () => {
    const policy = applyBookingPolicyTemplate('crm_demo');
    assert.deepEqual(policy.discussBeforeSave, []);
    const tool = buildCaptureDemoLeadToolDescription(policy);
    assert.doesNotMatch(tool, /MUST discuss: payment/);
    const prompt = buildBookingPolicyPrompt(policy);
    assert.doesNotMatch(prompt, /save gates only/i);
  });

  it('mergeSkillsConfig includes booking defaults', () => {
    const skills = mergeSkillsConfig(null);
    assert.equal(skills.booking?.templateId, 'crm_demo');
    const hotel = mergeSkillsConfig({
      booking: applyBookingPolicyTemplate('hotel_stay'),
    });
    assert.equal(hotel.booking?.outcome, 'stay');
  });

  it('rejects missing payment_discussed for hotel policy', () => {
    const policy = applyBookingPolicyTemplate('hotel_stay');
    const missing = missingBookingDiscussGates(policy, {});
    assert.deepEqual(missing, ['payment']);
    const reject = bookingDiscussGateRejection(missing);
    assert.equal(reject.ok, false);
    assert.match(reject.hint, /payment_discussed=true/);
    assert.match(reject.hint, /answer that first/i);
  });

  it('passes when payment_discussed is true', () => {
    const policy = applyBookingPolicyTemplate('hotel_stay');
    assert.deepEqual(missingBookingDiscussGates(policy, { payment_discussed: true }), []);
  });

  it('hotel tool description defers payment discuss to save turn', () => {
    const tool = buildCaptureDemoLeadToolDescription(applyBookingPolicyTemplate('hotel_stay'));
    assert.match(tool, /Immediately before this tool/i);
    assert.match(tool, /date-correction/i);
  });

  it('hotel vocabulary is stay-only — no showroom in allowed types', () => {
    const policy = applyBookingPolicyTemplate('hotel_stay');
    assert.equal(policy.bookingType, 'stay');
    assert.deepEqual(policy.allowedBookingTypes, ['stay']);
    assert.equal(policy.locationType, 'hotel');
    assert.match(policy.speakAs, /stay|hotel/i);
    const tool = buildCaptureDemoLeadToolDescription(policy);
    assert.match(tool, /booking_type=stay|\[stay\]/i);
    assert.doesNotMatch(tool, /showroom_visit/);
    assert.equal(resolveBookingType(policy, 'showroom_visit'), 'stay');
    assert.equal(resolveBookingType(policy, 'stay'), 'stay');
    assert.match(bookingSavedConfirmMessage(policy), /hotel stay booking/i);
  });

  it('merges legacy stay outcome without vocabulary fields', () => {
    const policy = mergeBookingPolicy({ outcome: 'stay', templateId: 'custom' });
    assert.equal(policy.bookingType, 'stay');
    assert.deepEqual(policy.allowedBookingTypes, ['stay']);
    assert.equal(policy.speakAs, 'hotel stay booking');
  });

  it('allows custom product booking types on policy', () => {
    const policy = mergeBookingPolicy({
      outcome: 'demo',
      templateId: 'custom',
      bookingType: 'clinic_visit',
      speakAs: 'clinic appointment',
      allowedBookingTypes: ['clinic_visit', 'follow_up'],
      locationType: 'online',
    });
    assert.equal(policy.bookingType, 'clinic_visit');
    assert.deepEqual(policy.allowedBookingTypes, ['clinic_visit', 'follow_up']);
    assert.equal(resolveBookingType(policy, 'follow_up'), 'follow_up');
    assert.equal(resolveBookingType(policy, 'showroom_visit'), 'clinic_visit');
  });
});
