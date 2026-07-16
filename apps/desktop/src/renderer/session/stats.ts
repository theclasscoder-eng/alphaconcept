/** Extract a compact connection-quality summary from an RTCStatsReport. */
export interface ConnectionQuality {
  rttMs: number | null;
  /** inbound (controller) or outbound (host) kbps. */
  kbps: number | null;
  packetsLost: number | null;
  state: RTCPeerConnectionState;
}

interface StatSample {
  bytes: number;
  ts: number;
}

export class QualityMonitor {
  private last: StatSample | null = null;

  async sample(pc: RTCPeerConnection): Promise<ConnectionQuality> {
    const report = await pc.getStats();
    let rttMs: number | null = null;
    let packetsLost: number | null = null;
    let bytes = 0;
    let hasByteCounter = false;

    report.forEach((stat) => {
      if (stat.type === 'candidate-pair' && (stat as RTCIceCandidatePairStats).nominated) {
        const rtt = (stat as RTCIceCandidatePairStats).currentRoundTripTime;
        if (typeof rtt === 'number') rttMs = Math.round(rtt * 1000);
      }
      if (stat.type === 'inbound-rtp' || stat.type === 'outbound-rtp') {
        const s = stat as RTCInboundRtpStreamStats & RTCOutboundRtpStreamStats;
        if (typeof s.bytesReceived === 'number') {
          bytes += s.bytesReceived;
          hasByteCounter = true;
        }
        if (typeof s.bytesSent === 'number') {
          bytes += s.bytesSent;
          hasByteCounter = true;
        }
        if (typeof (s as RTCInboundRtpStreamStats).packetsLost === 'number') {
          packetsLost = (s as RTCInboundRtpStreamStats).packetsLost ?? null;
        }
      }
    });

    let kbps: number | null = null;
    const now = Date.now();
    if (hasByteCounter) {
      if (this.last) {
        const deltaBytes = bytes - this.last.bytes;
        const deltaSec = (now - this.last.ts) / 1000;
        if (deltaSec > 0) kbps = Math.round((deltaBytes * 8) / 1000 / deltaSec);
      }
      this.last = { bytes, ts: now };
    }

    return { rttMs, kbps, packetsLost, state: pc.connectionState };
  }
}
