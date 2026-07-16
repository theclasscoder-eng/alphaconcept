/**
 * Time-limited TURN credential derivation, compatible with coturn's
 * `use-auth-secret` (a.k.a. REST API / long-term-credential) mechanism.
 *
 *   username   = <unix-expiry>[:<optional-user>]
 *   credential = base64( HMAC-SHA1( shared-secret, username ) )
 *
 * Coturn is configured with `static-auth-secret=<shared-secret>` and
 * `use-auth-secret`. The signaling server (which holds the secret) issues fresh
 * credentials to authenticated devices; the secret is NEVER sent to clients.
 */
import { createHmac } from 'node:crypto';

export interface TurnCredential {
  username: string;
  credential: string;
  /** Unix seconds when these credentials expire. */
  expiresAt: number;
}

export function deriveTurnCredentials(
  sharedSecret: string,
  ttlSeconds: number,
  user = '',
  now: () => number = Date.now,
): TurnCredential {
  const expiry = Math.floor(now() / 1000) + ttlSeconds;
  const username = user ? `${expiry}:${user}` : `${expiry}`;
  const credential = createHmac('sha1', sharedSecret).update(username).digest('base64');
  return { username, credential, expiresAt: expiry };
}
