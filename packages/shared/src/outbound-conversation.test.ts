import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyOutboundConversationTurn,
  emptyOutboundFocus,
  extractOutboundModel,
  extractOutboundVariant,
  isOutboundWaitUtterance,
  isOutboundAttentionUtterance,
  isOutboundStayOnLineUtterance,
  isOutboundAudioIssueUtterance,
  isOutboundConfusionUtterance,
  retrieveOutboundCatalog,
  shouldOutboundCutSpeech,
  productKnowledgeFromSources,
  emptySimulator2TurnState,
  mergeSkillsConfig,
  prepareSimulator2UserTurn,
} from './index.js';

const CATALOG = `## Sport
Sport has 16-inch wheels and a comfort setup.

## GT
GT has 17-inch alloys and a sporty bumper.

## Highline
Highline is the mid variant.
`;

const SPORT_ONLY = `## Sport
Sport has 16-inch wheels and a comfort setup.

## Highline
Highline is the mid variant.
`;

function baseTurn(heard: string, extra: Record<string, unknown> = {}) {
  return prepareSimulator2UserTurn({
    heard,
    lastAssistantText: 'Volkswagen se baat kar raha hoon.',
    recentAssistantTexts: ['Volkswagen se baat kar raha hoon.'],
    productName: 'Volkswagen',
    skills: mergeSkillsConfig(null),
    knownEmailDomains: [],
    state: emptySimulator2TurnState(),
    ...extra,
  });
}

describe('outbound conversation policy', () => {
  it('classifies wait, hello/sorry, and stay-on-line', () => {
    assert.equal(isOutboundWaitUtterance('Yeah, but'), true);
    assert.equal(isOutboundWaitUtterance('Yeah but'), true);
    assert.equal(isOutboundAttentionUtterance('Hello'), true);
    assert.equal(isOutboundAttentionUtterance('Sorry'), true);
    assert.equal(isOutboundStayOnLineUtterance('please stay on the line'), true);
    assert.equal(shouldOutboundCutSpeech('Hello'), true);
    assert.equal(shouldOutboundCutSpeech('Yeah, but'), true);
    assert.equal(extractOutboundVariant('GT ke baare mein batao'), 'GT');
    assert.equal(extractOutboundModel('Virtus GT'), 'Virtus');
  });

  it('retrieves GT chunks and does not use Sport for GT', () => {
    const gt = retrieveOutboundCatalog({
      knowledge: CATALOG,
      model: null,
      variant: 'GT',
      listVariants: false,
    });
    assert.equal(gt.found, true);
    assert.match(gt.snippet, /17-inch/);
    assert.doesNotMatch(gt.snippet, /16-inch/);
    assert.doesNotMatch(gt.snippet.toLowerCase(), /^## sport/m);

    const missing = retrieveOutboundCatalog({
      knowledge: SPORT_ONLY,
      model: null,
      variant: 'GT',
      listVariants: false,
    });
    assert.equal(missing.found, false);
  });

  it('mutes incomplete/hello/sorry and holds stay-on-line', () => {
    const waitTurn = applyOutboundConversationTurn({
      text: 'Yeah, but',
      productName: 'Volkswagen',
      productKnowledge: CATALOG,
      focus: emptyOutboundFocus(),
    });
    assert.equal(waitTurn.kind, 'mute');
    assert.equal(waitTurn.kind === 'mute' ? waitTurn.reason : '', 'outbound-incomplete');

    const hello = applyOutboundConversationTurn({
      text: 'Hello',
      productName: 'Volkswagen',
      productKnowledge: CATALOG,
      focus: emptyOutboundFocus(),
      openerDelivered: true,
    });
    assert.equal(hello.kind, 'continue');

    const helloBeforeOpener = applyOutboundConversationTurn({
      text: 'Hello',
      productName: 'Volkswagen',
      productKnowledge: CATALOG,
      focus: emptyOutboundFocus(),
      openerDelivered: false,
    });
    assert.equal(helloBeforeOpener.kind, 'mute');
    assert.equal(
      helloBeforeOpener.kind === 'mute' ? helloBeforeOpener.reason : '',
      'outbound-pickup-awaiting-opener',
    );

    const hold = applyOutboundConversationTurn({
      text: 'please stay on the line',
      productName: 'Volkswagen',
      productKnowledge: CATALOG,
      focus: emptyOutboundFocus(),
    });
    assert.equal(hold.kind, 'hold');
  });

  it('keeps GT in focus and refuses to substitute Sport when GT is missing', () => {
    const first = applyOutboundConversationTurn({
      text: 'GT ke baare mein batao',
      productName: 'Volkswagen',
      productKnowledge: CATALOG,
      focus: emptyOutboundFocus(),
    });
    assert.equal(first.kind, 'continue');
    if (first.kind !== 'continue') return;
    assert.equal(first.focus.variant, 'GT');
    assert.match(first.systemNote, /17-inch/);
    assert.doesNotMatch(first.systemNote, /16-inch/);
    assert.equal(first.skipBuyingPitch, true);

    const next = applyOutboundConversationTurn({
      text: 'mileage kya hai',
      productName: 'Volkswagen',
      productKnowledge: CATALOG,
      focus: first.focus,
    });
    assert.equal(next.kind, 'continue');
    if (next.kind !== 'continue') return;
    assert.equal(next.focus.variant, 'GT');
    assert.match(next.systemNote, /Current variant in focus: GT/);

    const missing = applyOutboundConversationTurn({
      text: 'GT ke specs batao',
      productName: 'Volkswagen',
      productKnowledge: SPORT_ONLY,
      focus: emptyOutboundFocus(),
    });
    assert.equal(missing.kind, 'continue');
    if (missing.kind !== 'continue') return;
    assert.match(missing.systemNote, /Do NOT substitute Sport/i);
  });

  it('builds product knowledge from compiled prompt when brief is short', () => {
    const compiled = 'Persona: sales\n\n## Product Knowledge\nGT has 17-inch alloys.\n## Voice rules\nBe brief.\n';
    const text = productKnowledgeFromSources('short', compiled);
    assert.match(text, /17-inch alloys/);
    assert.doesNotMatch(text, /Voice rules/);
  });
});

describe('prepareSimulator2UserTurn outbound-only', () => {
  it('leaves inbound Yeah-but / Hello unchanged (not muted by outbound policy)', async () => {
    const inboundBut = await baseTurn('Yeah, but');
    assert.notEqual(inboundBut.kind, 'mute');
    const inboundHello = await baseTurn('Hello there, what cars do you have?');
    assert.notEqual(inboundHello.kind, 'mute');
  });

  it('mutes outbound Yeah-but and Sorry; mutes Hello only before opener', async () => {
    for (const heard of ['Yeah, but', 'Sorry'] as const) {
      const result = await baseTurn(heard, {
        direction: 'outbound',
        productKnowledge: CATALOG,
      });
      assert.equal(result.kind, 'mute', heard);
    }
    const helloBeforeOpener = await baseTurn('Hello', {
      direction: 'outbound',
      productKnowledge: CATALOG,
    });
    assert.equal(helloBeforeOpener.kind, 'mute');
    const helloAfterOpener = await baseTurn('Hello', {
      direction: 'outbound',
      productKnowledge: CATALOG,
      openerDelivered: true,
    });
    assert.equal(helloAfterOpener.kind, 'reply');
  });

  it('puts outbound stay-on-the-line on hold', async () => {
    const result = await baseTurn('please stay on the line', {
      direction: 'outbound',
      productKnowledge: CATALOG,
    });
    assert.equal(result.kind, 'say');
    if (result.kind !== 'say') return;
    assert.equal(result.then, 'listen');
  });

  it('injects GT catalog on outbound and does not attach buying pitch', async () => {
    const result = await baseTurn('GT ke baare mein batao', {
      direction: 'outbound',
      productKnowledge: CATALOG,
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.match(result.userContent, /17-inch/);
    assert.doesNotMatch(result.userContent, /16-inch/);
    assert.doesNotMatch(result.userContent, /BUYING INTEREST/);
    assert.equal(result.state.outboundFocus.variant, 'GT');
  });

  it('leaves inbound audio complaints and Thank you unchanged', async () => {
    const inboundAudio = await baseTurn('आपकी आवाज़ नहीं आ रही हैलो');
    assert.notEqual(inboundAudio.kind, 'say');
    const inboundThanks = await baseTurn('Thank you');
    assert.notEqual(inboundThanks.kind, 'mute');
  });

  it('speaks Studio audio check on outbound audio+Hello, not an LLM pitch', async () => {
    const skills = mergeSkillsConfig(null);
    const checkLine = skills.core.audioIssue.checkLine;
    const result = await baseTurn('आपकी आवाज़ नहीं आ रही हैलो', {
      direction: 'outbound',
      productKnowledge: CATALOG,
      skills,
    });
    assert.equal(result.kind, 'say');
    if (result.kind !== 'say') return;
    assert.equal(result.text, checkLine);
    assert.equal(result.then, 'listen');
    assert.equal(result.state.outboundFocus.audioRepair, true);
    assert.equal(shouldOutboundCutSpeech('आपकी आवाज़ नहीं आ रही हैलो'), true);
    assert.equal(isOutboundAudioIssueUtterance('Awaaz nahi abhi. Hello.'), true);
  });

  it('does not run audio-check when hello/awaaz is mixed with a product question', async () => {
    const skills = mergeSkillsConfig(null);
    const result = await baseTurn(
      'hello hello meri awaaz aa rahi hai kya sedan dekh raha tha SUV ke baare mein bataiye',
      {
        direction: 'outbound',
        productKnowledge: CATALOG,
        skills,
      },
    );
    assert.notEqual(result.kind, 'say');
    const direct = applyOutboundConversationTurn({
      text: 'hello hello meri awaaz aa rahi hai sedan SUV turbo E20',
      productName: 'Volkswagen',
      productKnowledge: CATALOG,
      focus: emptyOutboundFocus(),
    });
    assert.notEqual(direct.kind, 'audio-check');
  });

  it('stays in audio repair on वापस आना चाहिए and does not hang up on Thank you', async () => {
    const skills = mergeSkillsConfig(null);
    const checkLine = skills.core.audioIssue.checkLine;
    const first = await baseTurn('Awaaz nahi abhi. Hello.', {
      direction: 'outbound',
      productKnowledge: CATALOG,
      skills,
    });
    assert.equal(first.kind, 'say');
    const follow = await baseTurn('वापस आना चाहिए', {
      direction: 'outbound',
      productKnowledge: CATALOG,
      skills,
      state: first.state,
    });
    assert.equal(follow.kind, 'say');
    if (follow.kind !== 'say') return;
    assert.equal(follow.text, checkLine);
    const thanks = await baseTurn('Thank you', {
      direction: 'outbound',
      productKnowledge: CATALOG,
      skills,
      state: follow.state,
    });
    assert.equal(thanks.kind, 'mute');
    assert.equal(thanks.kind === 'mute' ? thanks.reason : '', 'outbound-audio-thanks');
  });

  it('skips buying pitch on outbound sedan-kya / I-dont-know', async () => {
    const sedan = applyOutboundConversationTurn({
      text: 'सेडान क्या?',
      productName: 'Volkswagen',
      productKnowledge: CATALOG,
      focus: emptyOutboundFocus(),
    });
    assert.equal(sedan.kind, 'continue');
    if (sedan.kind !== 'continue') return;
    assert.equal(sedan.skipBuyingPitch, true);
    assert.equal(isOutboundConfusionUtterance('But I don\'t know about that'), true);

    const dunno = await baseTurn('But I don\'t know about that', {
      direction: 'outbound',
      productKnowledge: CATALOG,
    });
    assert.equal(dunno.kind, 'reply');
    if (dunno.kind !== 'reply') return;
    assert.doesNotMatch(dunno.userContent, /BUYING INTEREST/);
  });
});
