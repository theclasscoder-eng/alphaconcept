/**
 * Host-side WebRTC session. Captures the selected monitor via getUserMedia
 * (Electron desktop source) and answers the controller's offer. Incoming
 * control-channel messages are forwarded to the main process, which re-validates
 * and injects them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  QUALITY_PRESETS,
  type IceServer,
  type QualityLevel,
  type FrameRate,
} from '@rdp/protocol/browser';
import type { MonitorInfo, OutgoingSignal } from '../../shared-app/types.js';
import { QualityMonitor, type ConnectionQuality } from './stats.js';

type Send = (msg: OutgoingSignal) => void;

export interface HostCallbacks {
  onControl: (raw: unknown) => void;
  onQuality: (q: ConnectionQuality) => void;
  onClosed: (reason: string) => void;
  onCaptureError: (message: string) => void;
}

async function captureMonitor(
  monitor: MonitorInfo,
  quality: QualityLevel,
  frameRate: FrameRate,
): Promise<MediaStream> {
  const width = Math.round(monitor.bounds.width * monitor.scaleFactor);
  const height = Math.round(monitor.bounds.height * monitor.scaleFactor);
  const constraints: any = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: monitor.label,
        maxWidth: width,
        maxHeight: height,
        maxFrameRate: frameRate,
        minFrameRate: 5,
      },
    },
  };
  void quality;
  return navigator.mediaDevices.getUserMedia(constraints);
}

export class HostSession {
  private pc: RTCPeerConnection;
  private stream: MediaStream | null = null;
  private readonly monitorStats = new QualityMonitor();
  private statsTimer: number | null = null;
  private closed = false;

  constructor(
    readonly sessionId: string,
    iceServers: IceServer[],
    private monitor: MonitorInfo,
    private readonly send: Send,
    private readonly cb: HostCallbacks,
    private quality: QualityLevel,
    private frameRate: FrameRate,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] });
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({
          type: 'webrtc.ice-candidate',
          sessionId: this.sessionId,
          candidate: e.candidate.toJSON() as any,
        });
      }
    };
    this.pc.ondatachannel = (e) => {
      const ch = e.channel;
      ch.onmessage = (ev) => {
        let raw: unknown;
        try {
          raw = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        } catch {
          return;
        }
        this.cb.onControl(raw);
      };
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if ((s === 'failed' || s === 'closed') && !this.closed) this.cb.onClosed(`connection ${s}`);
    };
  }

  async start(): Promise<void> {
    try {
      this.stream = await captureMonitor(this.monitor, this.quality, this.frameRate);
    } catch (err) {
      this.cb.onCaptureError(String(err));
      throw err;
    }
    for (const track of this.stream.getTracks()) {
      this.pc.addTrack(track, this.stream);
    }
    this.applyEncoding();
    this.statsTimer = window.setInterval(async () => {
      if (this.closed) return;
      this.cb.onQuality(await this.monitorStats.sample(this.pc));
    }, 1000);
  }

  async onOffer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.send({
      type: 'webrtc.answer',
      sessionId: this.sessionId,
      sdp: { type: 'answer', sdp: answer.sdp ?? '' },
    });
  }

  async onRemoteIce(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      /* ignore */
    }
  }

  private applyEncoding(): void {
    const sender = this.pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0]!.maxBitrate = QUALITY_PRESETS[this.quality].maxBitrate;
    (params.encodings[0] as any).maxFramerate = this.frameRate;
    void sender.setParameters(params).catch(() => undefined);
  }

  setQuality(quality: QualityLevel, frameRate: FrameRate): void {
    this.quality = quality;
    this.frameRate = frameRate;
    this.applyEncoding();
  }

  /** Switch which monitor is shared without renegotiating the whole session. */
  async switchMonitor(monitor: MonitorInfo): Promise<void> {
    this.monitor = monitor;
    const newStream = await captureMonitor(monitor, this.quality, this.frameRate);
    const newTrack = newStream.getVideoTracks()[0]!;
    const sender = this.pc.getSenders().find((s) => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(newTrack);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = newStream;
    this.applyEncoding();
  }

  getMonitor(): MonitorInfo {
    return this.monitor;
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.statsTimer) window.clearInterval(this.statsTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    try {
      this.pc.close();
    } catch {
      /* noop */
    }
  }
}
