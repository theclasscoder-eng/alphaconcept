/**
 * Authentication utilities: short-lived session tokens (JWT via jose), device
 * challenge-nonce replay tracking, and time-limited ICE/TURN credential issuance.
 */
import { SignJWT, jwtVerify } from 'jose';
import { buildIceServers, type IceServerConfig } from '@rdp/config';
import { deriveTurnCredentials } from '@rdp/shared';
import { SESSION_TOKEN_TTL_SECONDS } from '@rdp/protocol';
import type { Env } from './env.js';

export class TokenService {
  private readonly key: Uint8Array;
  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async issue(deviceId: string): Promise<{ token: string; expiresAt: number }> {
    const expSeconds = Math.floor(Date.now() / 1000) + SESSION_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({ sub: deviceId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expSeconds)
      .setJti(crypto.randomUUID())
      .sign(this.key);
    return { token, expiresAt: expSeconds * 1000 };
  }

  async verify(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.key);
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }
}

/**
 * Bounded, TTL-based set of consumed challenge nonces. A nonce may be used at
 * most once, preventing replay of a captured authenticate message.
 */
export class NonceStore {
  private readonly seen = new Map<string, number>();
  constructor(private readonly ttlMs: number) {}

  /** Returns true if the nonce is fresh (and records it); false if already used. */
  consume(nonce: string, now = Date.now()): boolean {
    this.sweep(now);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now + this.ttlMs);
    return true;
  }

  private sweep(now: number): void {
    for (const [nonce, exp] of this.seen) {
      if (exp <= now) this.seen.delete(nonce);
    }
  }
}

/** Build ICE servers (STUN + optional time-limited TURN) for a device. */
export function issueIceServers(env: Env): IceServerConfig[] {
  if (env.TURN_URL && env.TURN_SHARED_SECRET) {
    const cred = deriveTurnCredentials(env.TURN_SHARED_SECRET, env.TURN_CREDENTIAL_TTL);
    return buildIceServers({
      stunUrl: env.STUN_URL,
      turn: { url: env.TURN_URL, username: cred.username, credential: cred.credential },
    });
  }
  return buildIceServers({ stunUrl: env.STUN_URL });
}
