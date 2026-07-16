/**
 * Local persistence for the desktop app:
 *   - device identity (public parts in JSON; PRIVATE key encrypted at rest via
 *     Electron safeStorage — DPAPI on Windows — never written in plaintext),
 *   - user settings,
 *   - paired devices and host-local unattended allow-list,
 *   - a minimal, non-sensitive session audit log.
 *
 * The decrypted private key is held only in main-process memory and never
 * exposed over IPC.
 */
import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import {
  generateDeviceKeyPair,
  deviceIdFromPublicKey,
  fingerprint,
  signMessage,
  connectionCodeProof,
  proofsEqual,
  FRAME_RATE_OPTIONS,
} from '@rdp/protocol';
import { DEFAULT_SIGNALING_URL, DEFAULT_STUN_URL } from '@rdp/config';
import type {
  AppSettings,
  AuditEntry,
  PairedDevice,
  PublicIdentity,
} from '../shared-app/types.js';

interface IdentityFile {
  deviceId: string;
  publicKey: string;
  name: string;
  encryptedPrivateKey: string; // base64 of safeStorage-encrypted PKCS#8
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
}

export class Store {
  private readonly dir: string;
  private readonly identityPath: string;
  private readonly settingsPath: string;
  private readonly pairedPath: string;
  private readonly auditPath: string;
  private readonly codesPath: string;

  private privateKey: string | null = null;
  private identity!: IdentityFile;

  constructor(baseDir?: string) {
    this.dir = baseDir ?? app.getPath('userData');
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.identityPath = join(this.dir, 'identity.json');
    this.settingsPath = join(this.dir, 'settings.json');
    this.pairedPath = join(this.dir, 'paired.json');
    this.auditPath = join(this.dir, 'audit.json');
    this.codesPath = join(this.dir, 'codes.json');
    this.loadIdentity();
  }

  // ---- identity -----------------------------------------------------------

  private ensureEncryption(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'OS secure storage is unavailable; refusing to store the device private key in plaintext.',
      );
    }
  }

  private loadIdentity(): void {
    if (existsSync(this.identityPath)) {
      const file = readJson<IdentityFile | null>(this.identityPath, null);
      if (file) {
        this.identity = file;
        this.ensureEncryption();
        this.privateKey = safeStorage
          .decryptString(Buffer.from(file.encryptedPrivateKey, 'base64'))
          .toString();
        return;
      }
    }
    // First launch: generate a new identity.
    this.ensureEncryption();
    const kp = generateDeviceKeyPair();
    const deviceId = deviceIdFromPublicKey(kp.publicKey);
    const encrypted = safeStorage.encryptString(kp.privateKey).toString('base64');
    this.identity = {
      deviceId,
      publicKey: kp.publicKey,
      name: hostname() || 'My Computer',
      encryptedPrivateKey: encrypted,
    };
    this.privateKey = kp.privateKey;
    writeJson(this.identityPath, this.identity);
  }

  getPublicIdentity(): PublicIdentity {
    return {
      deviceId: this.identity.deviceId,
      publicKey: this.identity.publicKey,
      name: this.identity.name,
      fingerprint: fingerprint(this.identity.publicKey),
    };
  }

  setDeviceName(name: string): PublicIdentity {
    const clean = name.trim().slice(0, 128) || this.identity.name;
    this.identity.name = clean;
    writeJson(this.identityPath, this.identity);
    // Keep the settings copy in sync.
    const s = this.getSettings();
    this.updateSettings({ ...s, deviceName: clean });
    return this.getPublicIdentity();
  }

  /** Sign data with the device private key. Used only inside the main process. */
  sign(data: string): string {
    if (!this.privateKey) throw new Error('private key unavailable');
    return signMessage(this.privateKey, data);
  }

  // ---- settings -----------------------------------------------------------

  private defaultSettings(): AppSettings {
    return {
      deviceName: this.identity.name,
      signalingUrl: process.env.SIGNALING_PUBLIC_URL || DEFAULT_SIGNALING_URL,
      stunUrl: DEFAULT_STUN_URL,
      turnUrl: '',
      allowIncoming: true,
      startOnLogin: false,
      clipboardSync: false,
      quality: 'balanced',
      frameRate: 30,
      hideOverlay: false,
      hideAdminWarning: false,
      unattendedDeviceIds: [],
    };
  }

  getSettings(): AppSettings {
    const stored = readJson<Partial<AppSettings>>(this.settingsPath, {});
    const merged = { ...this.defaultSettings(), ...stored };
    // Validate frameRate is one of the allowed options.
    if (!FRAME_RATE_OPTIONS.includes(merged.frameRate)) merged.frameRate = 30;
    return merged;
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...patch };
    writeJson(this.settingsPath, next);
    return next;
  }

  // ---- paired devices -----------------------------------------------------

  listPaired(): PairedDevice[] {
    return readJson<PairedDevice[]>(this.pairedPath, []);
  }

  upsertPaired(device: PairedDevice): void {
    const list = this.listPaired();
    const idx = list.findIndex((d) => d.deviceId === device.deviceId);
    if (idx >= 0) list[idx] = { ...list[idx], ...device };
    else list.push(device);
    writeJson(this.pairedPath, list);
  }

  removePaired(deviceId: string): void {
    const list = this.listPaired().filter((d) => d.deviceId !== deviceId);
    writeJson(this.pairedPath, list);
    const s = this.getSettings();
    this.updateSettings({
      unattendedDeviceIds: s.unattendedDeviceIds.filter((id) => id !== deviceId),
    });
    this.setConnectionCode(deviceId, null);
  }

  clearPaired(): string[] {
    const ids = this.listPaired().map((d) => d.deviceId);
    writeJson(this.pairedPath, []);
    this.updateSettings({ unattendedDeviceIds: [] });
    writeJson(this.codesPath, {});
    return ids;
  }

  setUnattended(deviceId: string, enabled: boolean): void {
    const s = this.getSettings();
    const set = new Set(s.unattendedDeviceIds);
    if (enabled) set.add(deviceId);
    else set.delete(deviceId);
    this.updateSettings({ unattendedDeviceIds: [...set] });
    const paired = this.listPaired().find((d) => d.deviceId === deviceId);
    if (paired) this.upsertPaired({ ...paired, unattended: enabled });
  }

  isUnattendedAllowed(deviceId: string): boolean {
    return this.getSettings().unattendedDeviceIds.includes(deviceId);
  }

  // ---- per-connection codes ----------------------------------------------
  //
  // The HOST stores, per controller device, an optional secret code encrypted at
  // rest (safeStorage/DPAPI). The controller enters it live each session — it is
  // never stored on the controller — and proves knowledge over the DTLS channel
  // via HMAC(code, sessionId). So a breach of one paired device grants nothing
  // without also knowing the per-connection code, and each host has its own.

  setConnectionCode(deviceId: string, code: string | null): void {
    const map = readJson<Record<string, string>>(this.codesPath, {});
    const clean = (code ?? '').trim();
    if (!clean) {
      delete map[deviceId];
    } else {
      this.ensureEncryption();
      map[deviceId] = safeStorage.encryptString(clean).toString('base64');
    }
    writeJson(this.codesPath, map);
  }

  requiresConnectionCode(deviceId: string): boolean {
    const map = readJson<Record<string, string>>(this.codesPath, {});
    return typeof map[deviceId] === 'string' && map[deviceId]!.length > 0;
  }

  listConnectionCodeDeviceIds(): string[] {
    return Object.keys(readJson<Record<string, string>>(this.codesPath, {}));
  }

  /** Verify a controller's HMAC proof against the stored code for this device. */
  verifyConnectionProof(deviceId: string, sessionId: string, proof: string): boolean {
    const map = readJson<Record<string, string>>(this.codesPath, {});
    const enc = map[deviceId];
    if (!enc) return true; // no code required for this device
    try {
      this.ensureEncryption();
      const code = safeStorage.decryptString(Buffer.from(enc, 'base64')).toString();
      return proofsEqual(connectionCodeProof(code, sessionId), proof);
    } catch {
      return false;
    }
  }

  // ---- audit --------------------------------------------------------------

  appendAudit(entry: AuditEntry): void {
    const list = readJson<AuditEntry[]>(this.auditPath, []);
    list.unshift(entry);
    writeJson(this.auditPath, list.slice(0, 500));
  }

  updateAudit(id: string, patch: Partial<AuditEntry>): void {
    const list = readJson<AuditEntry[]>(this.auditPath, []);
    const idx = list.findIndex((e) => e.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx]!, ...patch };
      writeJson(this.auditPath, list);
    }
  }

  getAudit(): AuditEntry[] {
    return readJson<AuditEntry[]>(this.auditPath, []);
  }

  clearAudit(): void {
    writeJson(this.auditPath, []);
  }
}
