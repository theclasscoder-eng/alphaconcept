/**
 * Cryptographic identity primitives shared by the desktop app (Electron main
 * process) and the signaling server. Both run under Node, so we use the built-in
 * `node:crypto` module and standard, audited algorithms only.
 *
 * Device identity is an Ed25519 key pair:
 *   - The PRIVATE key never leaves the device and is stored in the OS secure
 *     credential store (Electron safeStorage / DPAPI on Windows).
 *   - The PUBLIC key is registered with the signaling server and shared with
 *     paired peers. Its fingerprint is shown to users for out-of-band verification.
 *
 * We deliberately implement NO custom cryptography. All operations delegate to
 * `node:crypto`.
 */
import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as edSign,
  timingSafeEqual,
  verify as edVerify,
} from 'node:crypto';

export interface DeviceKeyPair {
  /** base64url-encoded SPKI (DER) public key. Safe to share. */
  publicKey: string;
  /** base64url-encoded PKCS#8 (DER) private key. MUST be stored securely. */
  privateKey: string;
}

/** Generate a fresh Ed25519 device identity. */
export function generateDeviceKeyPair(): DeviceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  };
}

function publicKeyObject(publicKeyB64url: string) {
  return createPublicKey({
    key: Buffer.from(publicKeyB64url, 'base64url'),
    format: 'der',
    type: 'spki',
  });
}

function privateKeyObject(privateKeyB64url: string) {
  return createPrivateKey({
    key: Buffer.from(privateKeyB64url, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Sign a UTF-8 string or buffer with an Ed25519 private key. Returns base64url. */
export function signMessage(privateKeyB64url: string, data: string | Buffer): string {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const key = privateKeyObject(privateKeyB64url);
  // Ed25519 uses `null` for the algorithm argument.
  return edSign(null, bytes, key).toString('base64url');
}

/** Verify an Ed25519 signature. Never throws; returns false on any error. */
export function verifySignature(
  publicKeyB64url: string,
  data: string | Buffer,
  signatureB64url: string,
): boolean {
  try {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const key = publicKeyObject(publicKeyB64url);
    return edVerify(null, bytes, key, Buffer.from(signatureB64url, 'base64url'));
  } catch {
    return false;
  }
}

/**
 * Human-readable fingerprint of a public key: uppercase hex bytes of the
 * SHA-256 of the raw SPKI, grouped in pairs. Shown to both users during pairing
 * so they can confirm they are talking to the intended device.
 */
export function fingerprint(publicKeyB64url: string): string {
  const digest = createHash('sha256').update(Buffer.from(publicKeyB64url, 'base64url')).digest();
  // Use the first 16 bytes for a readable, still collision-resistant fingerprint.
  return Array.from(digest.subarray(0, 16))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

/** Derive a stable device ID from a public key (URL-safe, 32 hex chars). */
export function deviceIdFromPublicKey(publicKeyB64url: string): string {
  return createHash('sha256')
    .update(Buffer.from(publicKeyB64url, 'base64url'))
    .digest('hex')
    .slice(0, 32);
}

/** Cryptographically secure random identifier (UUID v4). */
export function randomId(): string {
  return randomUUID();
}

/** Cryptographically secure random token, base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Generate a short, human-enterable pairing code using an unambiguous alphabet
 * (no 0/O/1/I). Uses rejection sampling over CSPRNG bytes to avoid modulo bias.
 */
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generatePairingCode(length: number): string {
  const out: string[] = [];
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 256 - (256 % PAIRING_ALPHABET.length)) {
        out.push(PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]!);
        if (out.length === length) break;
      }
    }
  }
  return out.join('');
}

/**
 * Stateless, tamper-evident device auth challenge.
 *
 * The server issues `{ challengeId, nonce, expiresAt, mac }`, where `mac` is an
 * HMAC over the other fields keyed by DEVICE_CHALLENGE_SECRET. The client signs
 * `nonce` with its device private key. On authenticate the server (a) re-verifies
 * the mac and expiry (proving it issued this challenge and it is fresh) and
 * (b) verifies the Ed25519 signature against the registered public key. Nonces
 * are additionally tracked once-only to prevent replay.
 */
export interface AuthChallenge {
  challengeId: string;
  nonce: string;
  expiresAt: number;
  mac: string;
}

function challengeMacInput(challengeId: string, nonce: string, expiresAt: number): string {
  return `${challengeId}.${nonce}.${expiresAt}`;
}

export function createAuthChallenge(secret: string, ttlMs: number): AuthChallenge {
  const challengeId = randomId();
  const nonce = randomToken(32);
  const expiresAt = Date.now() + ttlMs;
  const mac = createHmac('sha256', secret)
    .update(challengeMacInput(challengeId, nonce, expiresAt))
    .digest('base64url');
  return { challengeId, nonce, expiresAt, mac };
}

/** Verify a challenge's MAC and freshness. Returns false on tamper/expiry. */
/**
 * Per-connection code proof. The host stores a per-controller secret code; the
 * controller enters it live each session (it is never stored on the controller)
 * and proves knowledge without sending the code: proof = HMAC-SHA256(code,
 * sessionId), hex. Binding to the random sessionId prevents replay. This limits
 * blast radius — compromising one paired device does not grant access, because
 * the per-connection code is still required and differs per host.
 */
export function connectionCodeProof(code: string, sessionId: string): string {
  return createHmac('sha256', code).update(sessionId).digest('hex');
}

/** Constant-time comparison of two hex proof strings. */
export function proofsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyAuthChallenge(secret: string, challenge: AuthChallenge): boolean {
  if (typeof challenge.expiresAt !== 'number' || Date.now() > challenge.expiresAt) return false;
  const expected = createHmac('sha256', secret)
    .update(challengeMacInput(challenge.challengeId, challenge.nonce, challenge.expiresAt))
    .digest();
  const provided = Buffer.from(challenge.mac ?? '', 'base64url');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}
