/**
 * Main-process signaling client. Owns the WebSocket connection and the device
 * authentication handshake (which uses the private key held in the Store). The
 * renderer never sees the socket or the private key; it subscribes to parsed
 * server messages and connection-state changes over IPC.
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import {
  PROTOCOL_VERSION,
  randomId,
  parseServerMessage,
  encodeWire,
  decodeWire,
  type ServerMessage,
} from '@rdp/protocol';
import type { OutgoingSignal, SignalingState } from '../shared-app/types.js';
import type { Store } from './store.js';

const MAX_RECONNECT_ATTEMPTS = 5;

export class SignalingClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private state: SignalingState = {
    status: 'disconnected',
    deviceId: null,
    iceServers: [],
    lastError: null,
  };
  private reconnectAttempts = 0;
  private manualClose = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly store: Store) {
    super();
  }

  getState(): SignalingState {
    return this.state;
  }

  private setState(patch: Partial<SignalingState>): void {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  connect(): void {
    if (this.ws && (this.state.status === 'connecting' || this.state.status === 'connected')) {
      return;
    }
    this.manualClose = false;
    const url = this.store.getSettings().signalingUrl;
    this.setState({ status: 'connecting', lastError: null });

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.setState({ status: 'error', lastError: String(err) });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('message', (data: WebSocket.RawData) => this.onRaw(data));
    ws.on('open', () => this.setState({ status: 'authenticating' }));
    ws.on('error', (err) => {
      this.setState({ status: 'error', lastError: String(err) });
    });
    ws.on('close', () => {
      this.ws = null;
      if (this.state.status !== 'error') this.setState({ status: 'disconnected' });
      if (!this.manualClose) this.scheduleReconnect();
    });
  }

  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close(1000, 'client disconnect');
    this.ws = null;
    this.setState({ status: 'disconnected', deviceId: null });
  }

  private scheduleReconnect(): void {
    if (this.manualClose) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setState({ status: 'error', lastError: 'reconnect attempts exhausted' });
      return;
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private onRaw(data: WebSocket.RawData): void {
    let raw: unknown;
    try {
      raw = decodeWire(JSON.parse(data.toString()));
    } catch {
      return;
    }
    const parsed = parseServerMessage(raw);
    if (!parsed.success) return;
    const msg = parsed.data;

    if (msg.type === 'device.challenge') {
      this.authenticate(msg);
      return;
    }
    if (msg.type === 'device.authenticated') {
      this.reconnectAttempts = 0;
      this.setState({
        status: 'connected',
        deviceId: msg.deviceId,
        iceServers: msg.iceServers,
        lastError: null,
      });
      // Announce host availability if incoming connections are allowed.
      const allow = this.store.getSettings().allowIncoming;
      this.send({ type: 'device.presence.set', available: allow });
    }
    // Forward every server message to subscribers (renderer).
    this.emit('message', msg);
  }

  private authenticate(challenge: Extract<ServerMessage, { type: 'device.challenge' }>): void {
    const identity = this.store.getPublicIdentity();
    const signature = this.store.sign(challenge.nonce);
    this.rawSend({
      v: PROTOCOL_VERSION,
      id: randomId(),
      ts: Date.now(),
      from: identity.deviceId,
      type: 'device.authenticate',
      publicKey: identity.publicKey,
      name: identity.name,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      mac: challenge.mac,
      signature,
    });
  }

  /** Send a signaling command; the envelope is filled in here. */
  send(message: OutgoingSignal): void {
    const identity = this.state.deviceId ?? this.store.getPublicIdentity().deviceId;
    this.rawSend({
      v: PROTOCOL_VERSION,
      id: randomId(),
      ts: Date.now(),
      from: identity,
      ...message,
    });
  }

  private rawSend(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(encodeWire(obj as Record<string, unknown>)));
    }
  }
}
