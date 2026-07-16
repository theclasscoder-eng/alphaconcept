/**
 * Data-layer abstraction. The signaling hub depends only on this interface, so
 * it can run against Postgres (Prisma) in production or an in-memory store in
 * CI / local dev without external services. The interface stores ONLY session-
 * establishment metadata — never screen content, input, or clipboard data.
 */

export interface DeviceRecord {
  id: string;
  publicKey: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
}

export type PairingStatus = 'pending' | 'joined' | 'approved' | 'rejected' | 'expired';

export interface PairingRecord {
  id: string;
  code: string;
  creatorDeviceId: string;
  joinerDeviceId: string | null;
  status: PairingStatus;
  unattended: boolean;
  createdAt: number;
  expiresAt: number;
}

export type SessionStatus = 'requested' | 'approved' | 'rejected' | 'ended' | 'expired';

export interface SessionRecord {
  id: string;
  hostDeviceId: string;
  controllerDeviceId: string;
  status: SessionStatus;
  unattended: boolean;
  createdAt: number;
  expiresAt: number;
  endedBy: 'host' | 'controller' | 'server' | null;
}

export interface Repository {
  // --- devices ---
  upsertDevice(publicKey: string, name: string): Promise<DeviceRecord>;
  getDevice(id: string): Promise<DeviceRecord | null>;
  touchDevice(id: string): Promise<void>;

  // --- pairing (ephemeral) ---
  createPairing(record: PairingRecord): Promise<PairingRecord>;
  getPairingById(id: string): Promise<PairingRecord | null>;
  getActivePairingByCode(code: string, now: number): Promise<PairingRecord | null>;
  updatePairing(id: string, patch: Partial<PairingRecord>): Promise<PairingRecord | null>;
  expirePairings(now: number): Promise<number>;

  // --- trust (mutual) ---
  createTrust(deviceA: string, deviceB: string): Promise<void>;
  areTrusted(deviceA: string, deviceB: string): Promise<boolean>;
  listTrustedPeers(deviceId: string): Promise<string[]>;
  removeTrust(deviceA: string, deviceB: string): Promise<void>;

  // --- unattended grants (directed: host grants controller) ---
  grantUnattended(hostDeviceId: string, controllerDeviceId: string): Promise<void>;
  revokeUnattended(hostDeviceId: string, controllerDeviceId: string): Promise<void>;
  isUnattendedAllowed(hostDeviceId: string, controllerDeviceId: string): Promise<boolean>;

  // --- sessions (ephemeral metadata) ---
  createSession(record: SessionRecord): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | null>;
  updateSession(id: string, patch: Partial<SessionRecord>): Promise<SessionRecord | null>;
  expireSessions(now: number): Promise<number>;

  close(): Promise<void>;
}
