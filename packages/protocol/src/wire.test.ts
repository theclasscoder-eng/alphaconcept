import { describe, it, expect } from 'vitest';
import { encodeWire, decodeWire } from './wire.js';
import { SIGNALING_TYPES, parseClientMessage } from './signaling.js';
import { connectionCodeProof, proofsEqual } from './crypto.js';
import { PROTOCOL_VERSION } from './constants.js';

describe('wire codec', () => {
  it('round-trips every message type back to the semantic form', () => {
    for (const type of SIGNALING_TYPES) {
      const msg = { v: PROTOCOL_VERSION, id: 'x', ts: 123, from: 'dev', type, foo: 'bar' };
      const encoded = encodeWire(msg) as Record<string, unknown>;
      const decoded = decodeWire(encoded) as Record<string, unknown>;
      expect(decoded).toEqual(msg);
    }
  });

  it('removes the message-type name from the wire', () => {
    // Use a pairing message so there is no SDP whose value legitimately
    // contains words; the point is that OUR type names disappear.
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'x',
      ts: 1,
      from: 'dev',
      type: 'session.request',
      toDeviceId: 'h',
      sessionId: 's1',
      signature: 'sig',
    };
    const wire = JSON.stringify(encodeWire(msg));
    // The tell-tale message-type name is gone (payload keys like "sessionId"
    // are generic and not obfuscated — the codec targets the type discriminator).
    expect(wire).not.toContain('session.request');
    expect(wire).not.toContain('webrtc');
    expect(wire).not.toContain('pairing');
    expect(wire).not.toContain('"type":'); // envelope type key renamed to "e"
  });

  it('decoded output still passes strict schema validation', () => {
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'x',
      ts: Date.now(),
      from: 'dev',
      type: 'session.request',
      toDeviceId: 'h',
      sessionId: 's',
      signature: 'sig',
    };
    const decoded = decodeWire(encodeWire(msg));
    expect(parseClientMessage(decoded).success).toBe(true);
  });

  it('passes through already-semantic messages unchanged', () => {
    const msg = { v: PROTOCOL_VERSION, id: 'x', ts: 1, from: 'd', type: 'pairing.create' };
    expect(decodeWire(msg)).toEqual(msg);
  });

  it('produces no code collisions across all types', () => {
    const codes = new Set<string>();
    for (const t of SIGNALING_TYPES) {
      const wire = encodeWire({ v: 1, id: 'i', ts: 0, from: 'f', type: t }) as Record<string, unknown>;
      codes.add(String(wire.e));
    }
    expect(codes.size).toBe(SIGNALING_TYPES.length);
  });
});

describe('connection code proof', () => {
  it('matches for the same code + session, differs otherwise', () => {
    const p1 = connectionCodeProof('hunter2', 'sess-1');
    const p2 = connectionCodeProof('hunter2', 'sess-1');
    expect(proofsEqual(p1, p2)).toBe(true);

    expect(proofsEqual(p1, connectionCodeProof('hunter2', 'sess-2'))).toBe(false); // replay-bound
    expect(proofsEqual(p1, connectionCodeProof('wrong', 'sess-1'))).toBe(false); // wrong code
  });

  it('never contains the code itself', () => {
    const proof = connectionCodeProof('my-secret-code', 'sess-1');
    expect(proof).not.toContain('my-secret-code');
    expect(proof).toMatch(/^[0-9a-f]{64}$/);
  });
});
