import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildProductKnowledgeCatalogMap,
  chunkProductKnowledge,
  formatProductKnowledgeHits,
  isLargeProductKnowledge,
  keywordScores,
  PRODUCT_KNOWLEDGE_SEARCH_TOOL,
  rankProductKnowledgeChunks,
} from './product-knowledge.js';
import { compileSystemPrompt, mergeSkillsConfig, productKnowledgeForPrompt } from './index.js';

const bigBrain = [
  '# Nexora Stays',
  'Budget hostels and premium resorts across India.',
  '## Manali',
  '### Manali Resort',
  'Private rooms from 4500 per night. Heated pool, mountain view, breakfast included.',
  '',
  'Cancellation: free up to 48 hours before check-in; after that one night is charged.',
  '### Manali Hostel',
  'Dorm beds from 799 per night. Cafe, bonfire nights, co-working desk.',
  '## Rishikesh',
  '### Rishikesh Riverside',
  'Rafting packages, yoga deck, riverside cottages from 3200 per night.',
  ...Array.from({ length: 60 }, (_, i) => `## City ${i}\nProperty ${i} offers rooms from ${1000 + i} per night with wifi and parking.`),
].join('\n');

describe('chunkProductKnowledge', () => {
  it('keeps the heading path on each chunk', () => {
    const chunks = chunkProductKnowledge(bigBrain);
    const cancel = chunks.find((c) => c.content.includes('Cancellation'));
    assert.ok(cancel);
    assert.equal(cancel.heading, 'Nexora Stays > Manali > Manali Resort');
    assert.ok(chunks.every((c) => c.content.length <= 1_100));
  });

  it('splits an oversized paragraph', () => {
    const para = Array.from({ length: 80 }, (_, i) => `Fact number ${i} about the plan.`).join(' ');
    const chunks = chunkProductKnowledge(`## Plans\n${para}`);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((c) => c.heading === 'Plans' && c.content.length <= 1_100));
  });

  it('returns nothing for empty input', () => {
    assert.deepEqual(chunkProductKnowledge('   '), []);
  });
});

describe('ranking', () => {
  it('finds the matching chunk by keywords', () => {
    const hits = rankProductKnowledgeChunks('manali resort cancellation', chunkProductKnowledge(bigBrain), 2);
    assert.match(hits[0]!.content, /Cancellation/);
  });

  it('blends semantic scores when present', () => {
    const chunks = [
      { heading: 'A', content: 'pool and spa', semantic: 0.9 },
      { heading: 'B', content: 'pool pool pool', semantic: 0.1 },
    ];
    const hits = rankProductKnowledgeChunks('pool', chunks, 2);
    assert.equal(hits[0]!.heading, 'A');
  });

  it('scores zero when nothing overlaps', () => {
    assert.deepEqual(keywordScores('quantum', ['pool', 'spa']), [0, 0]);
  });

  it('formats hits within the size cap', () => {
    const hits = rankProductKnowledgeChunks('per night rooms', chunkProductKnowledge(bigBrain), 8);
    const text = formatProductKnowledgeHits(hits, 500);
    assert.ok(text.length <= 500);
    assert.match(text, /^\[/);
  });
});

describe('catalog map in the prompt', () => {
  it('keeps small brains inline', () => {
    const small = '## Plans\nStarter 999, Pro 1999.';
    assert.equal(isLargeProductKnowledge(small), false);
    assert.equal(productKnowledgeForPrompt({ brainMarkdown: small, brainSummary: '' }), small);
  });

  it('replaces large brains with a short map that points at the search tool', () => {
    const map = buildProductKnowledgeCatalogMap(bigBrain, '');
    assert.ok(map.length <= 1_500);
    assert.match(map, /- Manali/);

    const prompt = productKnowledgeForPrompt({ brainMarkdown: bigBrain, brainSummary: '' });
    assert.ok(prompt.length < 2_000);
    assert.ok(prompt.includes(PRODUCT_KNOWLEDGE_SEARCH_TOOL));
    assert.doesNotMatch(prompt, /Property 55 offers/);
  });

  it('lists the search tool in the compiled prompt', () => {
    const compiled = compileSystemPrompt({
      name: 'Riya',
      greeting: 'Hi',
      persona: 'friendly',
      productName: 'Nexora Stays',
      voiceId: 'Kore',
      voiceSpeed: 1,
      llmProvider: 'gpt',
      llmModel: 'gpt-5.4-mini',
      brainMarkdown: bigBrain,
      skillsConfig: mergeSkillsConfig(null),
    });
    assert.match(compiled, /## Tools\n- search_product_knowledge/);
    assert.match(compiled, /only a map of a larger catalog/);
  });
});
