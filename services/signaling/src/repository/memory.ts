/**
 * In-memory Repository implementation. Used for tests, CI, and zero-dependency
 * local development (SIGNALING_STORE=memory). Not durable across restarts.
 */
import { deviceIdFromPublicKey } from '@rdp/protocol';
import type {
  DeviceRecord,
  PairingRecord,
  Repository,
  SessionRecord,
} from './types.js';

function trustKey(a: string, b: string): string {
  return [a, b].sort().join('::');
}
function grantKey(host: string, controller: string): string {
  return `${host}->${controller}`;
}

export class MemoryRepository implements Repository {
  private devices = new Map<string, DeviceRecord>();
  private pairings = new Map<string, PairingRecord>();
  private trust = new Set<string>();
  private unattended = new Set<string>();
  private sessions = new Map<string, SessionRecord>();

  async upsertDevice(publicKey: string, name: string): Promise<DeviceRecord> {
    const id = deviceIdFromPublicKey(publicKey);
    const now = Date.now();
    const existing = this.devices.get(id);
    const record: DeviceRecord = existing
      ? { ...existing, name, lastSeenAt: now, publicKey }
      : { id, publicKey, name, createdAt: now, lastSeenAt: now };
    this.devices.set(id, record);
    return record;
  }

  async getDevice(id: string): Promise<DeviceRecord | null> {
    return this.devices.get(id) ?? null;
  }

  async touchDevice(id: string): Promise<void> {
    const d = this.devices.get(id);
    if (d) d.lastSeenAt = Date.now();
  }

  async createPairing(record: PairingRecord): Promise<PairingRecord> {
    this.pairings.set(record.id, { ...record });
    return record;
  }

  async getPairingById(id: string): Promise<PairingRecord | null> {
    return this.pairings.get(id) ?? null;
  }

  async getActivePairingByCode(code: string, now: number): Promise<PairingRecord | null> {
    for (const p of this.pairings.values()) {
      if (
        p.code === code &&
        p.expiresAt > now &&
        (p.status === 'pending' || p.status === 'joined')
      ) {
        return p;
      }
    }
    return null;
  }

  async updatePairing(id: string, patch: Partial<PairingRecord>): Promise<PairingRecord | null> {
    const p = this.pairings.get(id);
    if (!p) return null;
    const updated = { ...p, ...patch };
    this.pairings.set(id, updated);
    return updated;
  }

  async expirePairings(now: number): Promise<number> {
    let count = 0;
    for (const p of this.pairings.values()) {
      if (p.expiresAt <= now && (p.status === 'pending' || p.status === 'joined')) {
        p.status = 'expired';
        count++;
      }
    }
    return count;
  }

  async createTrust(deviceA: string, deviceB: string): Promise<void> {
    this.trust.add(trustKey(deviceA, deviceB));
  }

  async areTrusted(deviceA: string, deviceB: string): Promise<boolean> {
    return this.trust.has(trustKey(deviceA, deviceB));
  }

  async listTrustedPeers(deviceId: string): Promise<string[]> {
    const peers: string[] = [];
    for (const key of this.trust) {
      const [a, b] = key.split('::');
      if (a === deviceId && b) peers.push(b);
      else if (b === deviceId && a) peers.push(a);
    }
    return peers;
  }

  async removeTrust(deviceA: string, deviceB: string): Promise<void> {
    this.trust.delete(trustKey(deviceA, deviceB));
    // Revoking trust also revokes unattended in both directions.
    this.unattended.delete(grantKey(deviceA, deviceB));
    this.unattended.delete(grantKey(deviceB, deviceA));
  }

  async grantUnattended(hostDeviceId: string, controllerDeviceId: string): Promise<void> {
    this.unattended.add(grantKey(hostDeviceId, controllerDeviceId));
  }

  async revokeUnattended(hostDeviceId: string, controllerDeviceId: string): Promise<void> {
    this.unattended.delete(grantKey(hostDeviceId, controllerDeviceId));
  }

  async isUnattendedAllowed(hostDeviceId: string, controllerDeviceId: string): Promise<boolean> {
    return this.unattended.has(grantKey(hostDeviceId, controllerDeviceId));
  }

  async createSession(record: SessionRecord): Promise<SessionRecord> {
    this.sessions.set(record.id, { ...record });
    return record;
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async updateSession(id: string, patch: Partial<SessionRecord>): Promise<SessionRecord | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    const updated = { ...s, ...patch };
    this.sessions.set(id, updated);
    return updated;
  }

  async expireSessions(now: number): Promise<number> {
    let count = 0;
    for (const s of this.sessions.values()) {
      if (s.expiresAt <= now && s.status === 'requested') {
        s.status = 'expired';
        count++;
      }
    }
    return count;
  }

  async close(): Promise<void> {
    this.devices.clear();
    this.pairings.clear();
    this.trust.clear();
    this.unattended.clear();
    this.sessions.clear();
  }
}
