import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSimpleExplainSystemNote,
  compileSystemPrompt,
  emptySimulator2TurnState,
  isContinueLastTopicRequest,
  isSimpleExplainRequest,
  mergeSkillsConfig,
  prepareSimulator2UserTurn,
  shouldNudgeSimpleExplain,
  simpleExplainSkillLine,
} from './index.js';

const PRODUCT_HARDCODE = /taigun|virtus|tsi|cockpit|\bida\b|sunroof|volkswagen|gyarah/i;

describe('simple-explain (product-agnostic)', () => {
  it('detects simple-language and knowledge-gap asks in Latin and Devanagari', () => {
    assert.equal(isSimpleExplainRequest('नॉर्मल लैंग्वेज में बताओ?'), true);
    assert.equal(isSimpleExplainRequest('Then say through the normal.'), true);
    assert.equal(isSimpleExplainRequest('क्या ये मेरे को लैंग्वेज ही नहीं समझ आई दिस मतलब?'), true);
    assert.equal(isSimpleExplainRequest('नॉलेज नहीं है आप मुझे थोड़ा।'), true);
    assert.equal(isSimpleExplainRequest('Ye SAB ye mujhe knowledge nahi hai'), true);
    assert.equal(isSimpleExplainRequest('simple language me batao'), true);
    assert.equal(isSimpleExplainRequest('SUV dekhna hai'), false);
    assert.equal(isSimpleExplainRequest('price batao'), false);
  });

  it('detects continue-last-topic without treating it as a new pitch', () => {
    assert.equal(isContinueLastTopicRequest('नहीं, आप तो बात बता रहे थे?'), true);
    assert.equal(isContinueLastTopicRequest('aap to baat bata rahe the'), true);
    assert.equal(shouldNudgeSimpleExplain('नॉर्मल लैंग्वेज में बताओ?'), true);
    assert.equal(shouldNudgeSimpleExplain('SUV chahiye'), false);
  });

  it('keeps the skill and system note free of product/feature dictionaries', () => {
    assert.doesNotMatch(simpleExplainSkillLine(), PRODUCT_HARDCODE);
    assert.doesNotMatch(buildSimpleExplainSystemNote(), PRODUCT_HARDCODE);
    assert.match(simpleExplainSkillLine(), /Product Knowledge/);
    assert.match(buildSimpleExplainSystemNote(), /Product Knowledge only/);
    assert.match(buildSimpleExplainSystemNote(), /catalog labels/);
  });

  it('embeds SIMPLE EXPLAIN in the compiled brain without product names', () => {
    const compiled = compileSystemPrompt({
      name: 'Priya',
      greeting: 'Hi',
      persona: 'advisor',
      productName: 'Widget Pro',
      voiceId: 'v',
      voiceSpeed: 1,
      llmProvider: 'groq',
      llmModel: 'x',
      brainMarkdown: 'Widget Pro starts at 499.',
      skillsConfig: mergeSkillsConfig(null),
    });
    assert.match(compiled, /SIMPLE EXPLAIN/);
    assert.match(compiled, /everyday sentences/);
    assert.doesNotMatch(compiled, /## Skills \(short\)/);
  });

  it('lets confuse turns reach the LLM without a simple-explain script note', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'नॉर्मल लैंग्वेज में बताओ?',
      lastAssistantText: 'Entry plan starts at four hundred ninety nine.',
      recentAssistantTexts: ['Entry plan starts at four hundred ninety nine.'],
      productName: 'Widget Pro',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.doesNotMatch(result.userContent, /simpler explanation/i);
    assert.doesNotMatch(result.userContent, PRODUCT_HARDCODE);
  });

  it('does not sticky-inject a simple-explain note on the next turn', async () => {
    const first = await prepareSimulator2UserTurn({
      heard: 'simple language me batao',
      lastAssistantText: 'The entry plan has a dashboard and voice help.',
      recentAssistantTexts: [],
      productName: 'Widget Pro',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(first.kind, 'reply');
    const second = await prepareSimulator2UserTurn({
      heard: 'haan features bata do',
      lastAssistantText: 'Seedha bolti hoon — entry plan family use ke liye theek hai.',
      recentAssistantTexts: [],
      productName: 'Widget Pro',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: first.state,
    });
    assert.equal(second.kind, 'reply');
    if (second.kind !== 'reply') return;
    assert.doesNotMatch(second.userContent, /simpler explanation/i);
  });
});
