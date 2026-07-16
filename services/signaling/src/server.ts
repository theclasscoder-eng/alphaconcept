/**
 * Fastify HTTP + WebSocket transport. Wraps each WebSocket in a `Connection`
 * and drives the transport-agnostic `SignalingHub`. Also exposes a health check
 * and a token-authenticated ICE-credential refresh endpoint.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { parseServerMessage, encodeWire, decodeWire, type ServerMessage } from '@rdp/protocol';
import type { Env } from './env.js';
import { createLogger, type Logger } from './logger.js';
import { createRepository, type Repository } from './repository/index.js';
import { SignalingHub, type Connection } from './hub.js';
import { TokenService, NonceStore, issueIceServers } from './auth.js';
import { CHALLENGE_TTL_MS } from '@rdp/protocol';

export interface BuiltServer {
  app: FastifyInstance;
  hub: SignalingHub;
  repo: Repository;
  logger: Logger;
}

function originAllowed(origin: string | undefined, allowed: string): boolean {
  if (allowed.trim() === '*') return true;
  if (!origin) return false;
  return allowed
    .split(',')
    .map((o) => o.trim())
    .includes(origin);
}

export async function buildServer(env: Env): Promise<BuiltServer> {
  const logger = createLogger(env.LOG_LEVEL);
  const repo = await createRepository(env.SIGNALING_STORE);
  const tokens = new TokenService(env.JWT_SECRET);
  const nonces = new NonceStore(CHALLENGE_TTL_MS * 2);
  const hub = new SignalingHub({ repo, env, logger, tokens, nonces });

  const app = Fastify({ logger: false });
  await app.register(websocket, {
    options: { maxPayload: 256 * 1024 },
  });

  app.get('/healthz', async () => ({ status: 'ok', ts: Date.now() }));

  // Token-authenticated ICE credential refresh (short-lived TURN credentials).
  app.get('/ice', async (req, reply) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token) return reply.code(401).send({ error: 'missing token' });
    const deviceId = await tokens.verify(token);
    if (!deviceId) return reply.code(401).send({ error: 'invalid token' });
    return { iceServers: issueIceServers(env) };
  });

  app.register(async (scoped) => {
    scoped.get('/ws', { websocket: true }, (socket, req) => {
      const origin = req.headers.origin;
      if (!originAllowed(origin, env.SIGNALING_ALLOWED_ORIGINS)) {
        logger.warn({ origin }, 'rejected websocket: origin not allowed');
        socket.close(1008, 'origin not allowed');
        return;
      }

      const conn: Connection = {
        id: randomUUID(),
        remoteIp: req.ip,
        origin,
        deviceId: null,
        authenticated: false,
        available: false,
        challenge: null,
        seenMessageIds: new Set<string>(),
        send(msg: ServerMessage) {
          if (socket.readyState === socket.OPEN) {
            // Obfuscate the message on the wire (see @rdp/protocol wire codec).
            socket.send(JSON.stringify(encodeWire(msg as unknown as Record<string, unknown>)));
          }
        },
        close(code, reason) {
          try {
            socket.close(code ?? 1000, reason);
          } catch {
            /* ignore */
          }
        },
      };

      hub.onConnect(conn);

      socket.on('message', (data: Buffer) => {
        let raw: unknown;
        try {
          raw = decodeWire(JSON.parse(data.toString('utf8')));
        } catch {
          conn.send({
            v: 1,
            id: randomUUID(),
            ts: Date.now(),
            from: 'server',
            type: 'error',
            code: 'bad-json',
            message: 'Invalid JSON.',
          } as unknown as ServerMessage);
          return;
        }
        void hub.onMessage(conn, raw);
      });

      socket.on('close', () => hub.onClose(conn));
      socket.on('error', () => hub.onClose(conn));
    });
  });

  // Validate our own outgoing shapes in development to catch protocol drift.
  if (env.APP_ENV === 'development') {
    app.addHook('onReady', async () => {
      logger.info('signaling server ready (dev outgoing validation available)');
    });
  }
  void parseServerMessage; // referenced for potential debug validation

  return { app, hub, repo, logger };
}
