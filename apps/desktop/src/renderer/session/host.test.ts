/**
 * Regression tests for the host-side negotiation race.
 *
 * The controller sends its offer the moment a session is approved, but the host
 * needs a few hundred ms for getUserMedia() to return the screen. If the offer
 * is answered before addTrack() runs, the answer negotiates NO video: the
 * connection succeeds (input works) but the controller only ever sees black.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HostSession } from './host.js';
import type { MonitorInfo } from '../../shared-app/types.js';

const order: string[] = [];
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakeTrack {
  kind = 'video';
  stop(): void {}
}
class FakeStream {
  private t = [new FakeTrack()];
  getTracks(): FakeTrack[] {
    return this.t;
  }
  getVideoTracks(): FakeTrack[] {
    return this.t;
  }
}

class FakePeerConnection {
  connectionState = 'new';
  onicecandidate: unknown;
  ondatachannel: unknown;
  onconnectionstatechange: unknown;
  private senders: any[] = [];

  addTrack(track: unknown): unknown {
    order.push('addTrack');
    const sender = {
      track,
      getParameters: () => ({ encodings: [{}] }),
      setParameters: async () => undefined,
    };
    this.senders.push(sender);
    return sender;
  }
  getSenders(): any[] {
    return this.senders;
  }
  async setRemoteDescription(): Promise<void> {
    order.push('setRemoteDescription');
  }
  async createAnswer(): Promise<{ type: string; sdp: string }> {
    order.push('createAnswer');
    return { type: 'answer', sdp: 'answer-sdp' };
  }
  async setLocalDescription(): Promise<void> {
    order.push('setLocalDescription');
  }
  async addIceCandidate(): Promise<void> {}
  close(): void {}
}

const monitor: MonitorInfo = {
  id: '1',
  label: 'screen:0:0',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  primary: true,
};

let captureDelayMs = 50;
let captureShouldFail = false;

beforeEach(() => {
  order.length = 0;
  captureDelayMs = 50;
  captureShouldFail = false;
  // `navigator` is a read-only global in Node, so stubGlobal (not assignment).
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
  vi.stubGlobal('window', { setInterval: () => 0, clearInterval: () => undefined });
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => {
        await delay(captureDelayMs);
        if (captureShouldFail) throw new Error('capture denied');
        order.push('getUserMedia');
        return new FakeStream();
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeHost(sent: unknown[]) {
  return new HostSession(
    'sess-1',
    [],
    monitor,
    (m) => sent.push(m),
    {
      onControl: () => undefined,
      onQuality: () => undefined,
      onClosed: () => undefined,
      onCaptureError: () => undefined,
    },
    'low',
    15,
  );
}

describe('HostSession offer/capture race', () => {
  it('does not answer until the video track has been added', async () => {
    const sent: any[] = [];
    const host = makeHost(sent);

    // The offer arrives FIRST, while capture is still in flight.
    const offer = host.onOffer('offer-sdp');
    await host.start();
    await offer;

    // The track must be attached before the remote description is applied,
    // otherwise the answer carries no video.
    expect(order).toContain('addTrack');
    expect(order).toContain('setRemoteDescription');
    expect(order.indexOf('addTrack')).toBeLessThan(order.indexOf('setRemoteDescription'));
    expect(order.indexOf('addTrack')).toBeLessThan(order.indexOf('createAnswer'));

    const answer = sent.find((m) => m.type === 'webrtc.answer');
    expect(answer).toBeTruthy();
    expect(answer.sdp.sdp).toBe('answer-sdp');
  });

  it('still answers correctly when capture finishes before the offer', async () => {
    const sent: any[] = [];
    const host = makeHost(sent);
    await host.start();
    await host.onOffer('offer-sdp');

    expect(order.indexOf('addTrack')).toBeLessThan(order.indexOf('setRemoteDescription'));
    expect(sent.find((m) => m.type === 'webrtc.answer')).toBeTruthy();
  });

  it('does not answer at all when capture fails', async () => {
    captureShouldFail = true;
    const sent: any[] = [];
    const host = makeHost(sent);

    const offer = host.onOffer('offer-sdp');
    await expect(host.start()).rejects.toThrow();
    await offer;

    // No answer should be sent; the controller is told via session end instead.
    expect(sent.find((m) => m.type === 'webrtc.answer')).toBeUndefined();
    expect(order).not.toContain('setRemoteDescription');
  });

  it('does not answer after the session has been stopped', async () => {
    const sent: any[] = [];
    const host = makeHost(sent);
    const offer = host.onOffer('offer-sdp');
    host.stop();
    await offer;
    expect(sent.find((m) => m.type === 'webrtc.answer')).toBeUndefined();
  });
});
