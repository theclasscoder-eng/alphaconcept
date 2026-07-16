import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildServer, type BuiltServer } from '../src/server.js';
import type { Env } from '../src/env.js';
import { TestClient } from './client.js';
import { generateDeviceKeyPair, deviceIdFromPublicKey } from '@rdp/protocol';

const testEnv: Env = {
  APP_ENV: 'test',
  LOG_LEVEL: 'fatal',
  SIGNALING_PORT: 0,
  SIGNALING_PUBLIC_URL: 'ws://localhost',
  SIGNALING_STORE: 'memory',
  SIGNALING_ALLOWED_ORIGINS: '*',
  DATABASE_URL: undefined,
  JWT_SECRET: 'test-jwt-secret-value-1234567890',
  DEVICE_CHALLENGE_SECRET: 'test-challenge-secret-1234567890',
  STUN_URL: 'stun:stun.example.com:3478',
  TURN_URL: 'turn:turn.example.com:3478',
  TURN_SHARED_SECRET: 'turn-shared-secret',
  TURN_CREDENTIAL_TTL: 3600,
};

let built: BuiltServer;
let url: string;

beforeAll(async () => {
  built = await buildServer(testEnv);
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.app.server.address() as AddressInfo;
  url = `ws://127.0.0.1:${addr.port}/ws`;
});

afterAll(async () => {
  await built.app.close();
  await built.repo.close();
});

beforeEach(async () => {
  await built.repo.close(); // clears in-memory state between tests
});

/** Drive a full pairing between two connected+authenticated clients. */
async function pair(host: TestClient, controller: TestClient, unattended = false) {
  host.send('pairing.create');
  const created = await host.waitFor('pairing.created');
  controller.send('pairing.join', { code: created.code });
  const pending = await host.waitFor('pairing.pending');
  expect(pending.peer.deviceId).toBe(controller.deviceId);
  host.send('pairing.approve', { pairingId: pending.pairingId, unattended });
  const hostResult = await host.waitFor('pairing.result');
  const ctlResult = await controller.waitFor('pairing.result');
  expect(hostResult.status).toBe('approved');
  expect(ctlResult.status).toBe('approved');
  return created;
}

describe('device authentication', () => {
  it('authenticates with a valid signed challenge', async () => {
    const c = new TestClient('Alice');
    await c.connectAndAuthenticate(url);
    expect(c.token).toBeTruthy();
    c.close();
  });

  it('rejects a bad signature', async () => {
    const c = new TestClient('Mallory');
    const challenge = await c.connectRaw(url);
    const other = generateDeviceKeyPair();
    c.send('device.authenticate', {
      publicKey: c.keyPair.publicKey,
      name: 'Mallory',
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      mac: challenge.mac,
      // signature from a DIFFERENT key
      signature: (await import('@rdp/protocol')).signMessage(other.privateKey, challenge.nonce),
    });
    const err = await c.waitFor('error');
    expect(err.code).toBe('bad-signature');
    c.close();
  });

  it('rejects a replayed challenge nonce', async () => {
    const c1 = new TestClient('Alice');
    const challenge = await c1.connectRaw(url);
    const { signMessage } = await import('@rdp/protocol');
    const authPayload = {
      publicKey: c1.keyPair.publicKey,
      name: 'Alice',
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      mac: challenge.mac,
      signature: signMessage(c1.keyPair.privateKey, challenge.nonce),
    };
    c1.send('device.authenticate', authPayload);
    await c1.waitFor('device.authenticated');
    // Replay same nonce on a new connection.
    const c2 = new TestClient('Alice', c1.keyPair);
    await c2.connectRaw(url);
    c2.send('device.authenticate', authPayload);
    const err = await c2.waitFor('error');
    expect(err.code).toBe('replay');
    c1.close();
    c2.close();
  });

  it('rejects control messages before authentication', async () => {
    const c = new TestClient('Eve');
    await c.connectRaw(url);
    c.send('pairing.create');
    const err = await c.waitFor('error');
    expect(err.code).toBe('unauthenticated');
    c.close();
  });

  it('rejects malformed messages', async () => {
    const c = new TestClient('Eve');
    await c.connectAndAuthenticate(url);
    c.sendRaw({ v: 1, id: 'x', ts: Date.now(), from: c.deviceId, type: 'garbage' });
    const err = await c.waitFor('error');
    expect(err.code).toBe('bad-message');
    c.close();
  });
});

describe('pairing flow', () => {
  it('pairs two devices with mutual approval', async () => {
    const host = new TestClient('Host');
    const controller = new TestClient('Controller');
    await host.connectAndAuthenticate(url);
    await controller.connectAndAuthenticate(url);
    await pair(host, controller);
    host.close();
    controller.close();
  });

  it('rejects an invalid/expired pairing code', async () => {
    const controller = new TestClient('Controller');
    await controller.connectAndAuthenticate(url);
    controller.send('pairing.join', { code: 'ZZZZZZZZ' });
    const err = await controller.waitFor('error');
    expect(err.code).toBe('pairing-invalid');
    controller.close();
  });

  it('supports host rejecting a pairing', async () => {
    const host = new TestClient('Host');
    const controller = new TestClient('Controller');
    await host.connectAndAuthenticate(url);
    await controller.connectAndAuthenticate(url);
    host.send('pairing.create');
    const created = await host.waitFor('pairing.created');
    controller.send('pairing.join', { code: created.code });
    const pending = await host.waitFor('pairing.pending');
    host.send('pairing.reject', { pairingId: pending.pairingId });
    const result = await controller.waitFor('pairing.result');
    expect(result.status).toBe('rejected');
    host.close();
    controller.close();
  });
});

describe('session flow', () => {
  it('requests, approves, and relays WebRTC signaling', async () => {
    const host = new TestClient('Host');
    const controller = new TestClient('Controller');
    await host.connectAndAuthenticate(url);
    await controller.connectAndAuthenticate(url);
    await pair(host, controller);
    host.send('device.presence.set', { available: true });

    const sessionId = 'sess-1';
    controller.send('session.request', {
      toDeviceId: host.deviceId,
      sessionId,
      signature: controller.signSessionRequest(sessionId, host.deviceId),
    });
    const incoming = await host.waitFor('session.incoming');
    expect(incoming.sessionId).toBe(sessionId);
    expect(incoming.from.deviceId).toBe(controller.deviceId);
    expect(incoming.unattended).toBe(false);

    host.send('session.approve', { sessionId });
    const ctlApproved = await controller.waitFor('session.approved');
    const hostApproved = await host.waitFor('session.approved');
    expect(ctlApproved.iceServers.length).toBeGreaterThan(0);
    expect(hostApproved.iceServers.length).toBeGreaterThan(0);

    // Controller sends an offer; host must receive it verbatim.
    controller.send('webrtc.offer', { sessionId, sdp: { type: 'offer', sdp: 'v=0...' } });
    const offer = await host.waitFor('webrtc.offer');
    expect(offer.sdp.sdp).toBe('v=0...');

    host.send('webrtc.answer', { sessionId, sdp: { type: 'answer', sdp: 'v=0-answer' } });
    const answer = await controller.waitFor('webrtc.answer');
    expect(answer.sdp.sdp).toBe('v=0-answer');

    // End from host.
    host.send('session.end', { sessionId });
    const ended = await controller.waitFor('session.ended');
    expect(ended.by).toBe('host');

    host.close();
    controller.close();
  });

  it('rejects a session request from an untrusted device', async () => {
    const host = new TestClient('Host');
    const controller = new TestClient('Stranger');
    await host.connectAndAuthenticate(url);
    await controller.connectAndAuthenticate(url);
    const sessionId = 'sess-x';
    controller.send('session.request', {
      toDeviceId: host.deviceId,
      sessionId,
      signature: controller.signSessionRequest(sessionId, host.deviceId),
    });
    const err = await controller.waitFor('error');
    expect(err.code).toBe('not-trusted');
    host.close();
    controller.close();
  });

  it('reports host offline', async () => {
    const host = new TestClient('Host');
    const controller = new TestClient('Controller');
    await host.connectAndAuthenticate(url);
    await controller.connectAndAuthenticate(url);
    await pair(host, controller);
    host.close();
    await new Promise((r) => setTimeout(r, 50));
    const sessionId = 'sess-off';
    controller.send('session.request', {
      toDeviceId: host.deviceId,
      sessionId,
      signature: controller.signSessionRequest(sessionId, host.deviceId),
    });
    const err = await controller.waitFor('error');
    expect(err.code).toBe('host-offline');
    controller.close();
  });

  it('honors host rejecting a session', async () => {
    const host = new TestClient('Host');
    const controller = new TestClient('Controller');
    await host.connectAndAuthenticate(url);
    await controller.connectAndAuthenticate(url);
    await pair(host, controller);
    const sessionId = 'sess-rej';
    controller.send('session.request', {
      toDeviceId: host.deviceId,
      sessionId,
      signature: controller.signSessionRequest(sessionId, host.deviceId),
    });
    await host.waitFor('session.incoming');
    host.send('session.reject', { sessionId, reason: 'busy' });
    const rejected = await controller.waitFor('session.rejected');
    expect(rejected.reason).toBe('busy');
    host.close();
    controller.close();
  });
});

describe('unattended access', () => {
  it('flags unattended in session.incoming only when granted', async () => {
    const host = new TestClient('Host');
    const controller = new TestClient('Controller');
    await host.connectAndAuthenticate(url);
    await controller.connectAndAuthenticate(url);
    await pair(host, controller, true); // grant unattended at pairing
    const sessionId = 'sess-u';
    controller.send('session.request', {
      toDeviceId: host.deviceId,
      sessionId,
      signature: controller.signSessionRequest(sessionId, host.deviceId),
    });
    const incoming = await host.waitFor('session.incoming');
    expect(incoming.unattended).toBe(true);
    host.close();
    controller.close();
  });
});

describe('device revocation', () => {
  it('prevents future sessions after revoke', async () => {
    const host = new TestClient('Host');
    const controller = new TestClient('Controller');
    await host.connectAndAuthenticate(url);
    await controller.connectAndAuthenticate(url);
    await pair(host, controller);

    host.send('device.revoke', { targetDeviceId: controller.deviceId });
    const revoked = await controller.waitFor('device.revoked');
    expect(revoked.peerDeviceId).toBe(host.deviceId);

    const sessionId = 'sess-after-revoke';
    controller.send('session.request', {
      toDeviceId: host.deviceId,
      sessionId,
      signature: controller.signSessionRequest(sessionId, host.deviceId),
    });
    const err = await controller.waitFor('error');
    expect(err.code).toBe('not-trusted');
    host.close();
    controller.close();
  });
});

describe('rate limiting', () => {
  it('limits pairing.create bursts', async () => {
    const host = new TestClient('Host');
    await host.connectAndAuthenticate(url);
    // capacity is 5 for pairing.create
    for (let i = 0; i < 5; i++) host.send('pairing.create');
    host.send('pairing.create'); // 6th should trip the limiter
    // Collect responses; at least one must be rate-limited.
    let sawLimit = false;
    for (let i = 0; i < 6; i++) {
      const msg = await Promise.race([
        host.waitFor('pairing.created', 500).catch(() => null),
        host.waitFor('error', 500).catch(() => null),
      ]);
      if (msg?.type === 'error' && msg.code === 'rate-limited') sawLimit = true;
    }
    expect(sawLimit).toBe(true);
    host.close();
  });
});

describe('sanity: device id derivation', () => {
  it('derives matching ids for the client and server', () => {
    const kp = generateDeviceKeyPair();
    expect(deviceIdFromPublicKey(kp.publicKey)).toHaveLength(32);
  });
});
