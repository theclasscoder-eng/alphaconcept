/**
 * Postgres-backed Repository (production). Used when SIGNALING_STORE=prisma.
 *
 * The concrete `PrismaClient` is imported dynamically at runtime so that the
 * TypeScript build and CI do not require `prisma generate` to have run (which
 * needs the Prisma engine binaries). We describe the narrow slice of the client
 * API we use with a structural type; the real generated client satisfies it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { deviceIdFromPublicKey } from '@rdp/protocol';
import type {
  DeviceRecord,
  PairingRecord,
  Repository,
  SessionRecord,
} from './types.js';

interface Delegate {
  create(args: any): Promise<any>;
  findUnique(args: any): Promise<any>;
  findFirst(args: any): Promise<any>;
  findMany(args?: any): Promise<any[]>;
  update(args: any): Promise<any>;
  updateMany(args: any): Promise<{ count: number }>;
  upsert(args: any): Promise<any>;
  delete(args: any): Promise<any>;
  deleteMany(args: any): Promise<{ count: number }>;
  count(args?: any): Promise<number>;
}

interface PrismaLike {
  device: Delegate;
  pairing: Delegate;
  trust: Delegate;
  unattendedGrant: Delegate;
  session: Delegate;
  $disconnect(): Promise<void>;
}

function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function toDevice(row: any): DeviceRecord {
  return {
    id: row.id,
    publicKey: row.publicKey,
    name: row.name,
    createdAt: new Date(row.createdAt).getTime(),
    lastSeenAt: new Date(row.lastSeenAt).getTime(),
  };
}

function toPairing(row: any): PairingRecord {
  return {
    id: row.id,
    code: row.code,
    creatorDeviceId: row.creatorDeviceId,
    joinerDeviceId: row.joinerDeviceId ?? null,
    status: row.status,
    unattended: row.unattended,
    createdAt: new Date(row.createdAt).getTime(),
    expiresAt: new Date(row.expiresAt).getTime(),
  };
}

function toSession(row: any): SessionRecord {
  return {
    id: row.id,
    hostDeviceId: row.hostDeviceId,
    controllerDeviceId: row.controllerDeviceId,
    status: row.status,
    unattended: row.unattended,
    endedBy: row.endedBy ?? null,
    createdAt: new Date(row.createdAt).getTime(),
    expiresAt: new Date(row.expiresAt).getTime(),
  };
}

export class PrismaRepository implements Repository {
  private constructor(private readonly db: PrismaLike) {}

  static async create(): Promise<PrismaRepository> {
    const mod: any = await import('@prisma/client');
    const client = new mod.PrismaClient();
    return new PrismaRepository(client as PrismaLike);
  }

  async upsertDevice(publicKey: string, name: string): Promise<DeviceRecord> {
    const id = deviceIdFromPublicKey(publicKey);
    const row = await this.db.device.upsert({
      where: { id },
      create: { id, publicKey, name },
      update: { name, lastSeenAt: new Date() },
    });
    return toDevice(row);
  }

  async getDevice(id: string): Promise<DeviceRecord | null> {
    const row = await this.db.device.findUnique({ where: { id } });
    return row ? toDevice(row) : null;
  }

  async touchDevice(id: string): Promise<void> {
    await this.db.device.updateMany({ where: { id }, data: { lastSeenAt: new Date() } });
  }

  async createPairing(record: PairingRecord): Promise<PairingRecord> {
    const row = await this.db.pairing.create({
      data: {
        id: record.id,
        code: record.code,
        creatorDeviceId: record.creatorDeviceId,
        joinerDeviceId: record.joinerDeviceId,
        status: record.status,
        unattended: record.unattended,
        createdAt: new Date(record.createdAt),
        expiresAt: new Date(record.expiresAt),
      },
    });
    return toPairing(row);
  }

  async getPairingById(id: string): Promise<PairingRecord | null> {
    const row = await this.db.pairing.findUnique({ where: { id } });
    return row ? toPairing(row) : null;
  }

  async getActivePairingByCode(code: string, now: number): Promise<PairingRecord | null> {
    const row = await this.db.pairing.findFirst({
      where: {
        code,
        expiresAt: { gt: new Date(now) },
        status: { in: ['pending', 'joined'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toPairing(row) : null;
  }

  async updatePairing(id: string, patch: Partial<PairingRecord>): Promise<PairingRecord | null> {
    const data: Record<string, unknown> = { ...patch };
    if (patch.expiresAt !== undefined) data.expiresAt = new Date(patch.expiresAt);
    if (patch.createdAt !== undefined) data.createdAt = new Date(patch.createdAt);
    const row = await this.db.pairing.update({ where: { id }, data }).catch(() => null);
    return row ? toPairing(row) : null;
  }

  async expirePairings(now: number): Promise<number> {
    const res = await this.db.pairing.updateMany({
      where: { expiresAt: { lte: new Date(now) }, status: { in: ['pending', 'joined'] } },
      data: { status: 'expired' },
    });
    return res.count;
  }

  async createTrust(deviceA: string, deviceB: string): Promise<void> {
    const [a, b] = orderPair(deviceA, deviceB);
    await this.db.trust
      .upsert({ where: { deviceA_deviceB: { deviceA: a, deviceB: b } }, create: { deviceA: a, deviceB: b }, update: {} })
      .catch(async () => {
        // Fallback if composite unique naming differs.
        await this.db.trust.create({ data: { deviceA: a, deviceB: b } }).catch(() => undefined);
      });
  }

  async areTrusted(deviceA: string, deviceB: string): Promise<boolean> {
    const [a, b] = orderPair(deviceA, deviceB);
    const count = await this.db.trust.count({ where: { deviceA: a, deviceB: b } });
    return count > 0;
  }

  async listTrustedPeers(deviceId: string): Promise<string[]> {
    const rows = await this.db.trust.findMany({
      where: { OR: [{ deviceA: deviceId }, { deviceB: deviceId }] },
    });
    return rows.map((r) => (r.deviceA === deviceId ? r.deviceB : r.deviceA));
  }

  async removeTrust(deviceA: string, deviceB: string): Promise<void> {
    const [a, b] = orderPair(deviceA, deviceB);
    await this.db.trust.deleteMany({ where: { deviceA: a, deviceB: b } });
    await this.db.unattendedGrant.deleteMany({
      where: {
        OR: [
          { hostDeviceId: deviceA, controllerDeviceId: deviceB },
          { hostDeviceId: deviceB, controllerDeviceId: deviceA },
        ],
      },
    });
  }

  async grantUnattended(hostDeviceId: string, controllerDeviceId: string): Promise<void> {
    await this.db.unattendedGrant
      .upsert({
        where: { hostDeviceId_controllerDeviceId: { hostDeviceId, controllerDeviceId } },
        create: { hostDeviceId, controllerDeviceId },
        update: {},
      })
      .catch(async () => {
        await this.db.unattendedGrant
          .create({ data: { hostDeviceId, controllerDeviceId } })
          .catch(() => undefined);
      });
  }

  async revokeUnattended(hostDeviceId: string, controllerDeviceId: string): Promise<void> {
    await this.db.unattendedGrant.deleteMany({ where: { hostDeviceId, controllerDeviceId } });
  }

  async isUnattendedAllowed(hostDeviceId: string, controllerDeviceId: string): Promise<boolean> {
    const count = await this.db.unattendedGrant.count({
      where: { hostDeviceId, controllerDeviceId },
    });
    return count > 0;
  }

  async createSession(record: SessionRecord): Promise<SessionRecord> {
    const row = await this.db.session.create({
      data: {
        id: record.id,
        hostDeviceId: record.hostDeviceId,
        controllerDeviceId: record.controllerDeviceId,
        status: record.status,
        unattended: record.unattended,
        endedBy: record.endedBy,
        createdAt: new Date(record.createdAt),
        expiresAt: new Date(record.expiresAt),
      },
    });
    return toSession(row);
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const row = await this.db.session.findUnique({ where: { id } });
    return row ? toSession(row) : null;
  }

  async updateSession(id: string, patch: Partial<SessionRecord>): Promise<SessionRecord | null> {
    const data: Record<string, unknown> = { ...patch };
    if (patch.expiresAt !== undefined) data.expiresAt = new Date(patch.expiresAt);
    if (patch.createdAt !== undefined) data.createdAt = new Date(patch.createdAt);
    const row = await this.db.session.update({ where: { id }, data }).catch(() => null);
    return row ? toSession(row) : null;
  }

  async expireSessions(now: number): Promise<number> {
    const res = await this.db.session.updateMany({
      where: { expiresAt: { lte: new Date(now) }, status: 'requested' },
      data: { status: 'expired' },
    });
    return res.count;
  }

  async close(): Promise<void> {
    await this.db.$disconnect();
  }
}
