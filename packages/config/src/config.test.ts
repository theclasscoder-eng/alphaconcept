import { describe, it, expect } from 'vitest';
import { buildIceServers, connectionConfigSchema, DEFAULT_STUN_URL, SERVICE } from './index.js';

describe('service identity', () => {
  it('uses AlphaConcept uniformly for name, display, and description', () => {
    expect(SERVICE.name).toBe('AlphaConcept');
    expect(SERVICE.displayName).toBe('AlphaConcept');
    expect(SERVICE.description).toBe('AlphaConcept');
  });
});

describe('buildIceServers', () => {
  it('returns STUN only when no TURN is provided', () => {
    const servers = buildIceServers({ stunUrl: 'stun:example:3478' });
    expect(servers).toHaveLength(1);
    expect(servers[0]!.urls).toBe('stun:example:3478');
  });

  it('falls back to the default STUN url', () => {
    const servers = buildIceServers({});
    expect(servers[0]!.urls).toBe(DEFAULT_STUN_URL);
  });

  it('appends TURN with credentials', () => {
    const servers = buildIceServers({
      turn: { url: 'turn:example:3478', username: 'u', credential: 'c' },
    });
    expect(servers).toHaveLength(2);
    expect(servers[1]).toMatchObject({ urls: 'turn:example:3478', username: 'u', credential: 'c' });
  });
});

describe('connectionConfigSchema', () => {
  it('accepts a ws signaling url and defaults stun', () => {
    const cfg = connectionConfigSchema.parse({ signalingUrl: 'ws://localhost:8080/ws' });
    expect(cfg.stunUrl).toBe(DEFAULT_STUN_URL);
  });

  it('rejects a missing signaling url', () => {
    expect(() => connectionConfigSchema.parse({})).toThrow();
  });
});
