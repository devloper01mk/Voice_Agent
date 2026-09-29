import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideDeadAirRecovery,
  NO_RESPONSE_AFTER_TOOL_MS,
  NO_RESPONSE_AFTER_USER_MS,
  RECOVERY_COOLDOWN_MS,
} from './response-watchdog.js';

describe('decideDeadAirRecovery', () => {
  it('waits until the timeout', () => {
    assert.deepEqual(
      decideDeadAirRecovery({
        waitingSince: 0,
        timeoutMs: NO_RESPONSE_AFTER_USER_MS,
        reason: 'user_silence',
        now: NO_RESPONSE_AFTER_USER_MS - 1,
        lastRecoveryAt: -60_000,
        cooldownMs: RECOVERY_COOLDOWN_MS,
        agentState: 'listening',
      }),
      { action: 'wait' },
    );
  });

  it('recovers after the caller spoke and Gemini stayed silent', () => {
    assert.deepEqual(
      decideDeadAirRecovery({
        waitingSince: 0,
        timeoutMs: NO_RESPONSE_AFTER_USER_MS,
        reason: 'user_silence',
        now: NO_RESPONSE_AFTER_USER_MS,
        lastRecoveryAt: -60_000,
        cooldownMs: RECOVERY_COOLDOWN_MS,
        agentState: 'listening',
      }),
      { action: 'recover', reason: 'user_silence' },
    );
  });

  it('does not interrupt thinking or speaking', () => {
    const base = {
      waitingSince: 0,
      timeoutMs: NO_RESPONSE_AFTER_TOOL_MS,
      reason: 'tool_silence' as const,
      now: NO_RESPONSE_AFTER_TOOL_MS + 10,
      lastRecoveryAt: -60_000,
      cooldownMs: RECOVERY_COOLDOWN_MS,
    };
    assert.equal(decideDeadAirRecovery({ ...base, agentState: 'thinking' }).action, 'wait');
    assert.equal(decideDeadAirRecovery({ ...base, agentState: 'speaking' }).action, 'wait');
  });

  it('respects the cooldown so recoveries do not stack', () => {
    assert.deepEqual(
      decideDeadAirRecovery({
        waitingSince: 0,
        timeoutMs: NO_RESPONSE_AFTER_USER_MS,
        reason: 'user_silence',
        now: NO_RESPONSE_AFTER_USER_MS,
        lastRecoveryAt: NO_RESPONSE_AFTER_USER_MS - 100,
        cooldownMs: RECOVERY_COOLDOWN_MS,
        agentState: 'idle',
      }),
      { action: 'wait' },
    );
  });

  it('does nothing when no wait is armed', () => {
    assert.deepEqual(
      decideDeadAirRecovery({
        waitingSince: null,
        timeoutMs: NO_RESPONSE_AFTER_USER_MS,
        reason: 'user_silence',
        now: 10_000,
        lastRecoveryAt: -60_000,
        cooldownMs: RECOVERY_COOLDOWN_MS,
        agentState: 'listening',
      }),
      { action: 'wait' },
    );
  });
});
