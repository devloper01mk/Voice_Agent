import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyPlaybookTemplate,
  applyPlaybookToSkills,
  buildCaptureDemoLeadToolDescription,
  compileSystemPrompt,
  mergeBookingPolicy,
  mergeSkillsConfig,
  missingCustomFields,
  normalizePlaybook,
  PLAYBOOK_TEMPLATES,
  resolvePlaybook,
} from './index.js';

const base = {
  name: 'Aman',
  greeting: 'Hi',
  persona: 'friendly',
  productName: 'Sunrise Realty',
  voiceId: 'Kore',
  voiceSpeed: 1,
  llmProvider: 'gpt' as const,
  llmModel: 'gpt-5.4-mini',
  brainMarkdown: '## Flats\n2BHK from 65 lakh.',
};

describe('booking vocabulary is data, not industry defaults', () => {
  it('a plain visit outcome no longer says showroom / test drive', () => {
    const policy = mergeBookingPolicy({ outcome: 'visit', templateId: 'custom' });
    assert.equal(policy.speakAs, 'visit');
    assert.deepEqual(policy.allowedBookingTypes, ['visit']);
    const prompt = compileSystemPrompt({ ...base, skillsConfig: mergeSkillsConfig({ booking: policy }) });
    assert.doesNotMatch(prompt, /showroom|test drive/i);
  });

  it('accepts free-text location types', () => {
    assert.equal(mergeBookingPolicy({ locationType: 'Project Site' }).locationType, 'project_site');
  });
});

describe('real estate playbook end to end', () => {
  const { playbook, booking } = applyPlaybookTemplate('real_estate');
  const skills = mergeSkillsConfig({ booking });
  const prompt = compileSystemPrompt({ ...base, playbook, skillsConfig: skills });

  it('speaks the site-visit goal everywhere', () => {
    assert.match(prompt, /## Sales playbook \(Real estate\)/);
    assert.match(prompt, /Save outcome: \*\*site visit\*\*/);
    assert.match(prompt, /booking_type must be one of: site_visit/);
    assert.doesNotMatch(prompt, /showroom|test drive|hotel|check-in/i);
  });

  it('asks for playbook fields and passes them in details', () => {
    assert.match(prompt, /budget range → details\.budget \(required\)/);
    const effective = applyPlaybookToSkills(skills, playbook).booking;
    const tool = buildCaptureDemoLeadToolDescription(effective);
    assert.match(tool, /details \{budget\*, property_type\*, preferred_location\}/);
    assert.match(tool, /Save a site visit/);
  });

  it('server-side check lists missing required fields', () => {
    const effective = applyPlaybookToSkills(skills, playbook).booking;
    assert.deepEqual(
      missingCustomFields(effective, { budget: '80 lakh' }).map((f) => f.key),
      ['property_type'],
    );
    assert.deepEqual(missingCustomFields(effective, { budget: '80 lakh', property_type: '3BHK' }), []);
  });
});

describe('resolvePlaybook', () => {
  it('derives the goal from existing booking vocabulary when nothing is stored', () => {
    const pb = resolvePlaybook(null, {
      outcome: 'demo',
      templateId: 'custom',
      bookingType: 'clinic_visit',
      speakAs: 'clinic appointment',
    });
    assert.equal(pb.templateId, 'generic');
    assert.equal(pb.goal.label, 'clinic appointment');
    assert.equal(pb.goal.slug, 'clinic_visit');
  });

  it('a stored playbook wins over the booking policy', () => {
    const stored = PLAYBOOK_TEMPLATES.agri_advisory!.playbook;
    const skills = applyPlaybookToSkills(mergeSkillsConfig(null), stored);
    assert.equal(skills.booking?.speakAs, 'expert callback');
    assert.deepEqual(skills.booking?.allowedBookingTypes, ['expert_callback', 'field_visit']);
    assert.equal(skills.booking?.customFields?.length, 3);
  });
});

describe('normalizePlaybook', () => {
  it('rejects a playbook without a goal', () => {
    assert.equal(normalizePlaybook({ industry: 'X' }), null);
    assert.equal(normalizePlaybook('nope'), null);
  });

  it('caps lists and cleans field keys', () => {
    const pb = normalizePlaybook({
      industry: 'Clinics',
      goal: { label: 'Clinic Appointment' },
      discoveryQuestions: Array.from({ length: 20 }, (_, i) => `q${i}`),
      fields: [
        { label: 'Preferred Doctor', required: true },
        { key: 'preferred_doctor', label: 'dup' },
        { key: '9bad', label: 'bad key' },
      ],
    });
    assert.ok(pb);
    assert.equal(pb.goal.slug, 'clinic_appointment');
    assert.equal(pb.discoveryQuestions.length, 8);
    assert.deepEqual(pb.fields, [{ key: 'preferred_doctor', label: 'Preferred Doctor', required: true }]);
  });
});
