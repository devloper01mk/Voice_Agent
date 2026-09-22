import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isToolHoldEnabled,
  resolveToolHoldLine,
  TOOL_HOLD_TOOLS,
} from './tool-hold-lines.js';

describe('resolveToolHoldLine', () => {
  it('returns default lines for slow tools', () => {
    for (const tool of TOOL_HOLD_TOOLS) {
      const line = resolveToolHoldLine(tool);
      assert.ok(line && line.length > 3, tool);
    }
    assert.equal(resolveToolHoldLine('end_call'), null);
  });

  it('uses custom runtime lines when configured', () => {
    const line = resolveToolHoldLine('capture_demo_lead', {
      skills: {
        runtime: { toolHoldLines: { capture_demo_lead: 'Bas ek moment.' } },
      } as never,
    });
    assert.equal(line, 'Bas ek moment.');
  });

  it('adjusts grammar for male agents', () => {
    const line = resolveToolHoldLine('capture_demo_lead', { agentGender: 'male' });
    assert.match(line ?? '', /kar raha hoon/);
    assert.doesNotMatch(line ?? '', /kar rahi hoon/);
    assert.doesNotMatch(line ?? '', /kar rehi hoon/);
  });

  it('uses feminine rehi for female agents', () => {
    const line = resolveToolHoldLine('capture_demo_lead', { agentGender: 'female' });
    assert.match(line ?? '', /kar rehi hoon/);
    assert.doesNotMatch(line ?? '', /kar raha hoon/);
  });
});

describe('isToolHoldEnabled', () => {
  it('is on by default', () => {
    const prev = process.env.TELEPHONY_TOOL_HOLD;
    delete process.env.TELEPHONY_TOOL_HOLD;
    assert.equal(isToolHoldEnabled(), true);
    process.env.TELEPHONY_TOOL_HOLD = prev;
  });

  it('can be disabled via env', () => {
    const prev = process.env.TELEPHONY_TOOL_HOLD;
    process.env.TELEPHONY_TOOL_HOLD = '0';
    assert.equal(isToolHoldEnabled(), false);
    process.env.TELEPHONY_TOOL_HOLD = prev;
  });
});
