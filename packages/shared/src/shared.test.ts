import { describe, it, expect } from 'vitest';
import { redact, redactIp, redactToken } from './redact.js';
import { deriveTurnCredentials } from './turn.js';

describe('redaction', () => {
  it('masks IPv4 addresses', () => {
    expect(redactIp('client 203.0.113.9 connected')).toBe('client 203.x.x.x connected');
  });

  it('redacts sensitive keys deeply', () => {
    const out = redact({
      user: 'alice',
      token: 'super-secret-token-value',
      nested: { password: 'hunter2', ip: '10.1.2.3' },
      list: [{ signature: 'abcdef' }],
    }) as Record<string, unknown>;
    expect(out.user).toBe('alice');
    expect(String(out.token)).not.toContain('secret-token');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.password).not.toBe('hunter2');
    expect(nested.ip).toBe('10.x.x.x');
  });

  it('truncates tokens', () => {
    expect(redactToken('abcdefghijklmnop')).toMatch(/^abc…\*+$/);
    expect(redactToken('short')).toBe('***');
  });
});

describe('turn credentials', () => {
  it('derives deterministic time-limited credentials', () => {
    const now = () => 1_000_000_000_000; // fixed
    const a = deriveTurnCredentials('shared', 3600, '', now);
    const b = deriveTurnCredentials('shared', 3600, '', now);
    expect(a).toEqual(b);
    expect(a.username).toBe(String(1_000_000_000 + 3600));
    expect(a.credential).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('changes with the secret', () => {
    const now = () => 1_000_000_000_000;
    const a = deriveTurnCredentials('secret-a', 3600, '', now);
    const b = deriveTurnCredentials('secret-b', 3600, '', now);
    expect(a.credential).not.toBe(b.credential);
  });
});
