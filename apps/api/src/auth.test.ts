import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import {
  isApiAuthEnabled,
  isPublicApiPath,
  tokenMatches,
} from './auth.js';

describe('api auth', () => {
  const prev = process.env.API_AUTH_TOKEN;

  before(() => {
    process.env.API_AUTH_TOKEN = 'secret-test-token';
  });

  after(() => {
    if (prev === undefined) delete process.env.API_AUTH_TOKEN;
    else process.env.API_AUTH_TOKEN = prev;
  });

  it('enables when token configured', () => {
    assert.equal(isApiAuthEnabled(), true);
    assert.equal(tokenMatches('secret-test-token'), true);
    assert.equal(tokenMatches('wrong'), false);
    assert.equal(tokenMatches(null), false);
  });

  it('keeps Acefone webhook/voice paths public', () => {
    assert.equal(isPublicApiPath('/api/telephony/webhooks/call-status'), true);
    assert.equal(isPublicApiPath('/api/telephony/voice/endpoint'), true);
    assert.equal(isPublicApiPath('/api/telephony/outbound-call'), false);
    assert.equal(isPublicApiPath('/api/agents'), false);
  });
});
