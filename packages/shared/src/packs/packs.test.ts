import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildGeminiLiveS2sInstructionSupplement,
  compileSystemPrompt,
  mergeSkillsConfig,
  type AgentInput,
  type SkillsConfig,
} from '../index.js';
import { emptySimulator2TurnState, prepareSimulator2UserTurn } from '../simulator2-turn.js';
import { getPack, resolvePackForBooking, VERTICAL_PACKS } from './index.js';

/** Words that must never reach a non-matching industry's prompt. */
const HOTEL_OR_AUTO = /hotel|check-in|check-out|lookup_hotel_availability|showroom|dealership|test drive|engine size|Manali|Moustache|Volkswagen/i;

function agent(skills: Partial<SkillsConfig> | null, extra?: Partial<AgentInput>): AgentInput {
  return {
    name: 'Riya',
    greeting: 'Hi',
    persona: 'friendly',
    productName: 'Acme',
    voiceId: 'Kore',
    voiceSpeed: 1,
    llmProvider: 'gpt',
    llmModel: 'gpt-5.4-mini',
    brainMarkdown: '## Plans\nStarter 999 per month.',
    skillsConfig: mergeSkillsConfig(skills),
    ...extra,
  };
}

const HOTEL = { booking: { outcome: 'stay', templateId: 'hotel_stay', speakAs: 'hotel stay booking' } } as const;
const AUTO = { booking: { outcome: 'visit', templateId: 'auto_test_drive' } } as const;
const AGRI_CUSTOM = { booking: { outcome: 'callback', templateId: 'custom', speakAs: 'expert callback' } } as const;

describe('resolvePackForBooking', () => {
  it('only the stay outcome turns on the hotel integration', () => {
    assert.equal(resolvePackForBooking(null).id, 'generic');
    assert.equal(resolvePackForBooking(HOTEL.booking as never).id, 'hotel_stay');
    assert.equal(resolvePackForBooking({ outcome: 'stay', templateId: 'custom' }).id, 'hotel_stay');
    assert.equal(resolvePackForBooking(AUTO.booking as never).id, 'generic');
    assert.equal(resolvePackForBooking(AGRI_CUSTOM.booking as never).id, 'generic');
    assert.equal(getPack('nope').id, 'generic');
  });
});

describe('core prompts stay domain-free', () => {
  for (const [label, skills] of [
    ['default (CRM demo)', null],
    ['custom callback (e.g. agriculture)', AGRI_CUSTOM],
  ] as const) {
    it(`${label} prompt has no hotel/auto wording`, () => {
      const prompt = compileSystemPrompt(agent(skills as Partial<SkillsConfig> | null));
      assert.doesNotMatch(prompt, HOTEL_OR_AUTO);
    });
  }

  it('core S2S supplement has no hotel/auto wording', () => {
    assert.doesNotMatch(buildGeminiLiveS2sInstructionSupplement('Kore', 'gemini-3.8-live'), HOTEL_OR_AUTO);
  });

  it('core source files carry no brand / hotel wording', () => {
    const files = [
      '../simulator2-turn.ts',
      '../sales-support-skills.ts',
      '../gemini-live-config.ts',
      '../call-time.ts',
      '../contact-confirm.ts',
      '../natural-speech.ts',
      '../../../../apps/agent-v2/src/voice-agent.ts',
    ];
    for (const rel of files) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
      assert.doesNotMatch(src, /hotel|Moustache|Manali|dealership|showroom|test drive|Cronberry/i, rel);
    }
  });
});

describe('derived playbooks keep existing agents unchanged', () => {
  it('hotel agent gets stay playbook, lookup tool guidance, and S2S lines', () => {
    const prompt = compileSystemPrompt(agent(HOTEL as never));
    assert.match(prompt, /## Sales playbook \(Hotels \/ stays\)/);
    assert.match(prompt, /start AND end date/);
    assert.match(prompt, /check-in and check-out/);
    assert.match(prompt, /## Tools[\s\S]*lookup_hotel_availability — \*\*required\*\*/);
    assert.ok(VERTICAL_PACKS.hotel_stay.s2sRules.some((r) => /TOOL-FIRST/.test(r)));
  });

  it('auto agent gets dealership pricing rules from its playbook', () => {
    const prompt = compileSystemPrompt(agent(AUTO as never));
    assert.match(prompt, /## Sales playbook \(Automobiles\)/);
    assert.match(prompt, /ex-showroom or on-road/);
    assert.doesNotMatch(prompt, /lookup_hotel_availability|check-in/);
  });

  it('custom agent gets the generic playbook with its own goal', () => {
    const prompt = compileSystemPrompt(agent(AGRI_CUSTOM as never));
    assert.match(prompt, /## Sales playbook \(General\)/);
    assert.match(prompt, /\*\*expert callback\*\*/);
  });
});

describe('agent rules', () => {
  it('puts client rules right after persona, capped', () => {
    const prompt = compileSystemPrompt(
      agent(null, { agentRules: `- Only agriculture topics.\n${'x'.repeat(3_000)}` }),
    );
    const idx = prompt.indexOf('## Agent rules');
    assert.ok(idx > 0 && idx < prompt.indexOf('## Language'));
    assert.match(prompt, /Only agriculture topics/);
    assert.doesNotMatch(prompt, /x{1600}/);
  });

  it('omits the section when empty', () => {
    assert.doesNotMatch(compileSystemPrompt(agent(null)), /## Agent rules/);
  });
});

describe('turn notes follow the pack', () => {
  const turn = (heard: string, skills: Partial<SkillsConfig> | null) =>
    prepareSimulator2UserTurn({
      heard,
      lastAssistantText: 'Kaise help karun?',
      recentAssistantTexts: [],
      productName: 'Acme',
      skills: mergeSkillsConfig(skills),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });

  it('non-hotel catalog question gets the generic answer-first note', async () => {
    const result = await turn('Kaunse plans available hain?', null);
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.match(result.userContent, /Answer from Product Knowledge now/);
    assert.doesNotMatch(result.userContent, /lookup_hotel_availability/);
  });

  it('hotel city question still forces the live lookup', async () => {
    const result = await turn('Manali mein hotel hai?', HOTEL as never);
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.match(result.userContent, /lookup_hotel_availability|LIVE LOOKUP/);
  });
});
