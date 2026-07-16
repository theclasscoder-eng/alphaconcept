/**
 * Minimal test WebSocket client that performs the device auth handshake and
 * lets tests await specific message types. Used by the integration suite.
 */
import WebSocket from 'ws';
import {
  PROTOCOL_VERSION,
  generateDeviceKeyPair,
  deviceIdFromPublicKey,
  signMessage,
  randomId,
  type DeviceKeyPair,
} from '@rdp/protocol';

export class TestClient {
  readonly keyPair: DeviceKeyPair;
  readonly deviceId: string;
  token: string | null = null;
  private ws!: WebSocket;
  private readonly queue: any[] = [];
  private readonly waiters: { predicate: (m: any) => boolean; resolve: (m: any) => void }[] = [];

  constructor(
    readonly name: string,
    keyPair?: DeviceKeyPair,
  ) {
    this.keyPair = keyPair ?? generateDeviceKeyPair();
    this.deviceId = deviceIdFromPublicKey(this.keyPair.publicKey);
  }

  private dispatch(msg: any): void {
    const idx = this.waiters.findIndex((w) => w.predicate(msg));
    if (idx >= 0) {
      const [w] = this.waiters.splice(idx, 1);
      w!.resolve(msg);
    } else {
      this.queue.push(msg);
    }
  }

  waitFor(type: string, timeoutMs = 2000): Promise<any> {
    const predicate = (m: any) => m.type === type;
    const existing = this.queue.findIndex(predicate);
    if (existing >= 0) {
      const [m] = this.queue.splice(existing, 1);
      return Promise.resolve(m);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
      this.waiters.push({
        predicate,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  send(type: string, payload: Record<string, unknown> = {}): void {
    const msg = {
      v: PROTOCOL_VERSION,
      id: randomId(),
      ts: Date.now(),
      from: this.deviceId,
      type,
      ...payload,
    };
    this.ws.send(JSON.stringify(msg));
  }

  /** Send a raw (possibly malformed) object for negative tests. */
  sendRaw(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }

  private open(url: string): Promise<void> {
    this.ws = new WebSocket(url);
    // Attach the message handler synchronously BEFORE the socket opens so the
    // immediately-sent challenge frame cannot race ahead of the listener.
    this.ws.on('message', (data) => {
      try {
        this.dispatch(JSON.parse(data.toString()));
      } catch {
        /* ignore */
      }
    });
    return new Promise<void>((resolve, reject) => {
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
    });
  }

  async connectAndAuthenticate(url: string): Promise<void> {
    await this.open(url);
    const challenge = await this.waitFor('device.challenge');
    this.send('device.authenticate', {
      publicKey: this.keyPair.publicKey,
      name: this.name,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      mac: challenge.mac,
      signature: signMessage(this.keyPair.privateKey, challenge.nonce),
    });
    const authed = await this.waitFor('device.authenticated');
    this.token = authed.token;
  }

  /** Connect and grab the challenge without authenticating (for negative tests). */
  async connectRaw(url: string): Promise<any> {
    await this.open(url);
    return this.waitFor('device.challenge');
  }

  signSessionRequest(sessionId: string, hostDeviceId: string): string {
    return signMessage(this.keyPair.privateKey, `${sessionId}.${hostDeviceId}`);
  }

  close(): void {
    this.ws?.close();
  }
}
