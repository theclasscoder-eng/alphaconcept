/**
 * Controller-side WebRTC session. Receives the host's screen on a recvonly video
 * transceiver and sends validated input over a reliable data channel.
 */
import {
  CONTROL_CHANNEL_LABEL,
  INPUT_PROTOCOL_VERSION,
  type IceServer,
  type ControlMessage,
} from '@rdp/protocol/browser';
import type { OutgoingSignal } from '../../shared-app/types.js';
import { QualityMonitor, type ConnectionQuality } from './stats.js';

type Send = (msg: OutgoingSignal) => void;

/** Distributive Omit so each control-message variant keeps its own keys. */
type ControlInput<T = ControlMessage> = T extends unknown ? Omit<T, 'v' | 'seq' | 't'> : never;

export interface ControllerCallbacks {
  onStream: (stream: MediaStream) => void;
  onQuality: (q: ConnectionQuality) => void;
  onClosed: (reason: string) => void;
  onChannelOpen: () => void;
  /** Incoming control message from the host (e.g. code handshake). */
  onControl: (raw: unknown) => void;
}

export class ControllerSession {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel;
  private seq = 0;
  private readonly monitor = new QualityMonitor();
  private statsTimer: number | null = null;
  private closed = false;

  constructor(
    readonly sessionId: string,
    iceServers: IceServer[],
    private readonly send: Send,
    private readonly cb: ControllerCallbacks,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] });
    this.channel = this.pc.createDataChannel(CONTROL_CHANNEL_LABEL, { ordered: true });
    this.channel.onopen = () => {
      this.sendControl({ type: 'control.hello', role: 'controller', protocolVersion: INPUT_PROTOCOL_VERSION });
      this.cb.onChannelOpen();
    };
    this.channel.onmessage = (ev) => {
      try {
        this.cb.onControl(JSON.parse(typeof ev.data === 'string' ? ev.data : ''));
      } catch {
        /* ignore malformed */
      }
    };
    this.pc.addTransceiver('video', { direction: 'recvonly' });
    this.pc.ontrack = (e) => {
      if (e.streams[0]) this.cb.onStream(e.streams[0]);
    };
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({
          type: 'webrtc.ice-candidate',
          sessionId: this.sessionId,
          candidate: e.candidate.toJSON() as ControlIce,
        });
      }
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed' || s === 'disconnected') {
        if (!this.closed && s !== 'disconnected') this.cb.onClosed(`connection ${s}`);
      }
    };
  }

  async start(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.send({
      type: 'webrtc.offer',
      sessionId: this.sessionId,
      sdp: { type: 'offer', sdp: offer.sdp ?? '' },
    });
    this.statsTimer = window.setInterval(async () => {
      if (this.closed) return;
      this.cb.onQuality(await this.monitor.sample(this.pc));
    }, 1000);
  }

  async onAnswer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  async onRemoteIce(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      /* ignore late/duplicate candidates */
    }
  }

  /** Send a control message; the input envelope (v/seq/t) is filled in here. */
  sendControl(msg: ControlInput): void {
    if (this.channel.readyState !== 'open') return;
    const full = { v: INPUT_PROTOCOL_VERSION, seq: this.seq++, t: Date.now(), ...msg };
    this.channel.send(JSON.stringify(full));
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.statsTimer) window.clearInterval(this.statsTimer);
    try {
      this.channel.close();
    } catch {
      /* noop */
    }
    try {
      this.pc.close();
    } catch {
      /* noop */
    }
  }
}

// The ICE candidate JSON shape accepted by the protocol schema.
type ControlIce = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};
