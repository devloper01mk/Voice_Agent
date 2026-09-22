import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trimSpokenHistoryForLlm } from './spoken-history.ts';

describe('trimSpokenHistoryForLlm', () => {
  it('returns short histories unchanged', () => {
    const history = [
      { role: 'assistant', content: 'Hi Rahul' },
      { role: 'user', content: 'haan' },
    ];
    assert.deepEqual(trimSpokenHistoryForLlm(history), history);
  });

  it('keeps the opener and the latest spoken turns', () => {
    const history = [
      { role: 'assistant', content: 'opener' },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `t${i}`,
      })),
    ];
    const trimmed = trimSpokenHistoryForLlm(history, 8);
    assert.equal(trimmed[0]?.content, 'opener');
    assert.equal(trimmed[1]?.role, 'user');
    assert.equal(trimmed.at(-1)?.content, 't19');
    assert.ok(trimmed.length <= 9);
    assert.ok(!trimmed.some((m) => m.content === 't0'));
  });

  it('does not rewrite a typical call so the prompt prefix can cache', () => {
    const history = [
      { role: 'assistant', content: 'opener' },
      ...Array.from({ length: 24 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `t${i}`,
      })),
    ];
    const trimmed = trimSpokenHistoryForLlm(history);
    assert.deepEqual(
      trimmed.map((m) => m.content),
      history.map((m) => m.content),
    );
  });

  it('sanitizes prior user System notes while pinning the opener', () => {
    const history = [
      { role: 'assistant', content: 'opener' },
      {
        role: 'user',
        content: 'Jaipur hai\n\n[System: CALL FACTS THIS CALL — already known: city=Jaipur.]',
      },
      { role: 'assistant', content: 'Kab convenient rahega?' },
      {
        role: 'user',
        content: '5 PM\n\n[System: CALL FACTS THIS CALL — already known: city=Jaipur; preferred_time=today 5 PM.]',
      },
    ];
    const trimmed = trimSpokenHistoryForLlm(history, 8);
    assert.equal(trimmed[0]?.content, 'opener');
    assert.equal(trimmed[1]?.content, 'Jaipur hai');
    assert.match(trimmed.at(-1)?.content ?? '', /5 PM/);
    assert.match(trimmed.at(-1)?.content ?? '', /CALL FACTS/);
  });
});
