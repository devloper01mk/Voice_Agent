import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  clearPendingCall,
  countRecentPendingCalls,
  countRecentPendingCallsMatchingTail,
  getPendingCall,
  purgeExpiredPendingCalls,
  registerPendingCall,
} from './call-registry.js';

describe('call-registry TTL', () => {
  beforeEach(() => {
    // Clear by overwriting with fresh registers then clearing known ids
    for (const id of ['a', 'b', 'old']) clearPendingCall(id);
  });

  it('registers and clears pending calls', () => {
    registerPendingCall({
      callId: 'a',
      agentId: 'agent',
      toNumber: '9876543210',
      createdAt: Date.now(),
    });
    assert.equal(getPendingCall('a')?.callId, 'a');
    clearPendingCall('a');
    assert.equal(getPendingCall('a'), undefined);
  });

  it('purges expired pending entries on next register', () => {
    registerPendingCall({
      callId: 'old',
      agentId: 'agent',
      toNumber: '9111111111',
      createdAt: Date.now() - 60 * 60 * 1000,
    });
    registerPendingCall({
      callId: 'b',
      agentId: 'agent',
      toNumber: '9222222222',
      createdAt: Date.now(),
    });
    assert.equal(getPendingCall('old'), undefined);
    assert.equal(getPendingCall('b')?.callId, 'b');
    assert.equal(purgeExpiredPendingCalls(), 0);
    clearPendingCall('b');
  });

  it('counts unique tails without sole-pending ambiguity helper', () => {
    registerPendingCall({
      callId: 'a',
      agentId: 'agent',
      toNumber: '+919876543210',
      createdAt: Date.now(),
    });
    registerPendingCall({
      callId: 'b',
      agentId: 'agent',
      toNumber: '9876543210',
      createdAt: Date.now(),
    });
    assert.equal(countRecentPendingCallsMatchingTail('9876543210'), 2);
    assert.equal(countRecentPendingCalls() >= 2, true);
    clearPendingCall('a');
    clearPendingCall('b');
  });
});
