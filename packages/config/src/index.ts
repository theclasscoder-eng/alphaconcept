/**
 * Shared, validated network configuration used by both the desktop app and the
 * signaling server. Keeping this in one package guarantees both ends agree on
 * the shape of ICE / STUN / TURN settings.
 */
import { z } from 'zod';

/** A public STUN server needs no credentials. */
export const DEFAULT_STUN_URL = 'stun:stun.l.google.com:19302';

/**
 * Single source of truth for OS service-manager identity. If the signaling
 * service is installed as a background service (Windows SCM or Linux systemd),
 * the Service Name, Display Name, and Description all use this uniformly.
 */
export const SERVICE = {
  name: 'AlphaConcept',
  displayName: 'AlphaConcept',
  description: 'AlphaConcept',
} as const;

export const iceServerConfigSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServerConfig = z.infer<typeof iceServerConfigSchema>;

/** User-configurable connection settings persisted in the desktop app. */
export const connectionConfigSchema = z.object({
  signalingUrl: z.string().url().or(z.string().startsWith('ws')),
  stunUrl: z.string().default(DEFAULT_STUN_URL),
  /** TURN url is optional; TURN credentials are fetched from the signaling server. */
  turnUrl: z.string().optional(),
});
export type ConnectionConfig = z.infer<typeof connectionConfigSchema>;

export const DEFAULT_SIGNALING_URL = 'ws://localhost:8080/ws';

/** Build a browser-consumable RTCConfiguration iceServers array. */
export function buildIceServers(opts: {
  stunUrl?: string;
  turn?: { url: string; username: string; credential: string };
}): IceServerConfig[] {
  const servers: IceServerConfig[] = [{ urls: opts.stunUrl ?? DEFAULT_STUN_URL }];
  if (opts.turn) {
    servers.push({
      urls: opts.turn.url,
      username: opts.turn.username,
      credential: opts.turn.credential,
    });
  }
  return servers;
}
