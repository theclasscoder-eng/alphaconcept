import { describe, it, expect } from 'vitest';
import {
  generateDeviceKeyPair,
  signMessage,
  verifySignature,
  fingerprint,
  deviceIdFromPublicKey,
  generatePairingCode,
  createAuthChallenge,
  verifyAuthChallenge,
} from './crypto.js';
import { TokenBucket, KeyedRateLimiter } from './rate-limit.js';
import {
  computeContentRect,
  viewerPixelToNormalized,
  normalizedToLogicalPoint,
  normalizedToPhysicalPoint,
} from './coordinates.js';
import { parseClientMessage } from './signaling.js';
import { parseControlMessage } from './input.js';
import { PROTOCOL_VERSION, INPUT_PROTOCOL_VERSION } from './constants.js';

describe('crypto: device identity', () => {
  it('signs and verifies with a generated key pair', () => {
    const kp = generateDeviceKeyPair();
    const sig = signMessage(kp.privateKey, 'hello world');
    expect(verifySignature(kp.publicKey, 'hello world', sig)).toBe(true);
  });

  it('rejects a signature for different data', () => {
    const kp = generateDeviceKeyPair();
    const sig = signMessage(kp.privateKey, 'hello world');
    expect(verifySignature(kp.publicKey, 'tampered', sig)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const a = generateDeviceKeyPair();
    const b = generateDeviceKeyPair();
    const sig = signMessage(a.privateKey, 'data');
    expect(verifySignature(b.publicKey, 'data', sig)).toBe(false);
  });

  it('does not throw on garbage input', () => {
    expect(verifySignature('not-a-key', 'data', 'not-a-sig')).toBe(false);
  });

  it('produces a stable, formatted fingerprint and device id', () => {
    const kp = generateDeviceKeyPair();
    const fp = fingerprint(kp.publicKey);
    expect(fp).toMatch(/^([0-9A-F]{2}:){15}[0-9A-F]{2}$/);
    expect(fingerprint(kp.publicKey)).toBe(fp);
    expect(deviceIdFromPublicKey(kp.publicKey)).toHaveLength(32);
  });
});

describe('crypto: pairing codes', () => {
  it('produces codes of the requested length from an unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePairingCode(8);
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
    }
  });

  it('is effectively unique across many generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generatePairingCode(8));
    expect(seen.size).toBe(500);
  });
});

describe('crypto: auth challenge', () => {
  const secret = 'test-challenge-secret';

  it('verifies a freshly issued challenge', () => {
    const ch = createAuthChallenge(secret, 30_000);
    expect(verifyAuthChallenge(secret, ch)).toBe(true);
  });

  it('rejects a challenge with a wrong secret', () => {
    const ch = createAuthChallenge(secret, 30_000);
    expect(verifyAuthChallenge('other-secret', ch)).toBe(false);
  });

  it('rejects a tampered nonce', () => {
    const ch = createAuthChallenge(secret, 30_000);
    expect(verifyAuthChallenge(secret, { ...ch, nonce: ch.nonce + 'x' })).toBe(false);
  });

  it('rejects an expired challenge', () => {
    const ch = createAuthChallenge(secret, -1);
    expect(verifyAuthChallenge(secret, ch)).toBe(false);
  });

  it('full flow: device signs nonce, server verifies', () => {
    const kp = generateDeviceKeyPair();
    const ch = createAuthChallenge(secret, 30_000);
    const sig = signMessage(kp.privateKey, ch.nonce);
    expect(verifyAuthChallenge(secret, ch)).toBe(true);
    expect(verifySignature(kp.publicKey, ch.nonce, sig)).toBe(true);
  });
});

describe('rate-limit: token bucket', () => {
  it('allows up to capacity then blocks', () => {
    const now = 0;
    const b = new TokenBucket({ capacity: 3, refillPerSecond: 1, now: () => now });
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(false);
  });

  it('refills over time', () => {
    let now = 0;
    const b = new TokenBucket({ capacity: 2, refillPerSecond: 2, now: () => now });
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(false);
    now = 1000; // +1s -> +2 tokens
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(false);
  });

  it('keyed limiter isolates keys', () => {
    const now = 0;
    const rl = new KeyedRateLimiter({ capacity: 1, refillPerSecond: 0, now: () => now });
    expect(rl.tryConsume('a')).toBe(true);
    expect(rl.tryConsume('a')).toBe(false);
    expect(rl.tryConsume('b')).toBe(true);
  });
});

describe('coordinates: letterbox + translation', () => {
  it('computes a centered content rect (pillarbox) for a wide viewport', () => {
    const rect = computeContentRect({ width: 1000, height: 500 }, { width: 1000, height: 1000 });
    // Square video in a 2:1 viewport -> full height, centered horizontally.
    expect(rect.height).toBe(500);
    expect(rect.width).toBe(500);
    expect(rect.x).toBe(250);
    expect(rect.y).toBe(0);
  });

  it('computes a centered content rect (letterbox) for a tall viewport', () => {
    const rect = computeContentRect({ width: 500, height: 1000 }, { width: 1000, height: 500 });
    // 2:1 video in a 1:2 viewport -> full width, centered vertically.
    expect(rect.width).toBe(500);
    expect(rect.height).toBe(250);
    expect(rect.y).toBe(375);
  });

  it('maps a viewer pixel inside the content to normalized coords', () => {
    const content = { x: 250, y: 0, width: 500, height: 500 };
    const n = viewerPixelToNormalized({ x: 500, y: 250 }, content);
    expect(n.nx).toBeCloseTo(0.5);
    expect(n.ny).toBeCloseTo(0.5);
    expect(n.inBounds).toBe(true);
  });

  it('flags pointers over the letterbox bars as out of bounds', () => {
    const content = { x: 250, y: 0, width: 500, height: 500 };
    const n = viewerPixelToNormalized({ x: 10, y: 250 }, content);
    expect(n.inBounds).toBe(false);
    expect(n.nx).toBe(0); // clamped
  });

  it('translates normalized coords to logical host point with offset', () => {
    const display = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, scaleFactor: 1 };
    const p = normalizedToLogicalPoint({ nx: 0.5, ny: 0.5 }, display);
    expect(p.x).toBe(1920 + 1280);
    expect(p.y).toBe(720);
  });

  it('applies scale factor for physical pixel mapping', () => {
    const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.5 };
    const p = normalizedToPhysicalPoint({ nx: 1, ny: 1 }, display);
    expect(p.x).toBe(Math.round(1920 * 1.5));
    expect(p.y).toBe(Math.round(1080 * 1.5));
  });
});

describe('signaling message validation', () => {
  const base = { v: PROTOCOL_VERSION, id: 'm1', ts: Date.now(), from: 'dev-1' };

  it('accepts a well-formed session.request', () => {
    const r = parseClientMessage({
      ...base,
      type: 'session.request',
      toDeviceId: 'dev-2',
      sessionId: 's1',
      signature: 'sig',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown protocol version', () => {
    const r = parseClientMessage({ ...base, v: 999, type: 'pairing.create' });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown message type', () => {
    const r = parseClientMessage({ ...base, type: 'totally.unknown' });
    expect(r.success).toBe(false);
  });

  it('rejects extra/unknown keys (strict)', () => {
    const r = parseClientMessage({ ...base, type: 'pairing.create', injected: 'evil' });
    expect(r.success).toBe(false);
  });

  it('rejects a pairing.join without a code', () => {
    const r = parseClientMessage({ ...base, type: 'pairing.join' });
    expect(r.success).toBe(false);
  });
});

describe('input control message validation', () => {
  const base = { v: INPUT_PROTOCOL_VERSION, seq: 1, t: Date.now() };

  it('accepts a valid mouse move', () => {
    const r = parseControlMessage({ ...base, type: 'input.mouse.move', p: { nx: 0.5, ny: 0.5 } });
    expect(r.success).toBe(true);
  });

  it('rejects out-of-range coordinates', () => {
    const r = parseControlMessage({ ...base, type: 'input.mouse.move', p: { nx: 1.5, ny: 0.5 } });
    expect(r.success).toBe(false);
  });

  it('rejects an impossible key code', () => {
    const r = parseControlMessage({ ...base, type: 'input.key', action: 'down', code: 'Nope' });
    expect(r.success).toBe(false);
  });

  it('accepts a valid key code', () => {
    const r = parseControlMessage({ ...base, type: 'input.key', action: 'down', code: 'A' });
    expect(r.success).toBe(true);
  });

  it('rejects a wrong input protocol version', () => {
    const r = parseControlMessage({ ...base, v: 99, type: 'input.mouse.move', p: { nx: 0, ny: 0 } });
    expect(r.success).toBe(false);
  });

  it('rejects oversized text entry', () => {
    const r = parseControlMessage({ ...base, type: 'input.text', text: 'x'.repeat(5000) });
    expect(r.success).toBe(false);
  });
});
