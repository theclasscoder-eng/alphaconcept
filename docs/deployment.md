# Deployment

This covers self-hosting the **signaling service**, **Postgres**, and a **coturn**
TURN/STUN server. A signaling server alone does **not** replace TURN: many
networks (symmetric NAT, restrictive firewalls) require a relay, so deploy TURN
for reliable connectivity.

## Prerequisites

- A host with a **public, routable IP** (a VPS works well).
- A domain name (e.g. `signal.example.com`) for TLS/WSS.
- Docker + Docker Compose, or Node 20+/Postgres/coturn installed directly.
- Open ports (see below).

## 1. Configure environment

```bash
cp .env.example .env
# Generate strong secrets:
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('DEVICE_CHALLENGE_SECRET='+require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('TURN_SHARED_SECRET='+require('crypto').randomBytes(32).toString('base64url'))"
```

Fill `.env`:

```
APP_ENV=production
SIGNALING_STORE=prisma
DATABASE_URL=postgresql://rdp:<pw>@postgres:5432/rdp?schema=public
SIGNALING_PUBLIC_URL=wss://signal.example.com/ws
SIGNALING_ALLOWED_ORIGINS=app://.,file://    # lock down in production
JWT_SECRET=...
DEVICE_CHALLENGE_SECRET=...
STUN_URL=stun:signal.example.com:3478
TURN_URL=turn:signal.example.com:3478
TURN_HOST=signal.example.com
TURN_PORT=3478
TURN_SHARED_SECRET=...
```

## 2. Bring up the stack

```bash
docker compose -f infrastructure/docker-compose.yml up -d
docker compose -f infrastructure/docker-compose.yml logs -f signaling
```

The signaling container runs `prisma migrate deploy` on start when
`SIGNALING_STORE=prisma`. Health check: `GET /healthz` → `{status:"ok"}`.

To run migrations manually:

```bash
pnpm --filter @rdp/signaling db:deploy   # production (applies committed migrations)
pnpm --filter @rdp/signaling db:migrate  # development (creates a migration)
```

## 3. TLS + reverse proxy (WSS)

Terminate TLS at nginx and upgrade the WebSocket. Use
`infrastructure/deployment/nginx.conf.example` as a template, obtain certs with
certbot, and point the desktop app's **Signaling server URL** to
`wss://signal.example.com/ws`.

## 4. coturn / TURN

- Set `static-auth-secret` = `TURN_SHARED_SECRET` and enable `use-auth-secret`
  (see `infrastructure/coturn/turnserver.conf`).
- Set `external-ip=<PUBLIC_IP>` so relayed candidates are routable.
- For production, enable TLS/DTLS (`tls-listening-port=5349`, `cert`, `pkey`).

### Ports / firewall

| Service | Port(s) | Proto | Notes |
| --- | --- | --- | --- |
| Signaling (behind nginx) | 443 | TCP | WSS + health/ICE |
| Signaling (direct) | 8080 | TCP | internal |
| STUN/TURN control | 3478 | TCP+UDP | |
| TURN TLS/DTLS | 5349 | TCP+UDP | production |
| TURN relay range | 49160–49200 | UDP | must match coturn `min/max-port` |
| Postgres | 5432 | TCP | keep private (not public) |

## 5. Operations

- **Restart behavior:** compose services use `restart: unless-stopped`.
- **Logs:** signaling logs to stdout (Pino JSON, redacted); `docker compose logs`.
  coturn logs to stdout.
- **Health checks:** `GET /healthz`; the compose file defines container health
  checks for Postgres and signaling.
- **Backups:** back up the Postgres volume (`pgdata`). It holds device public
  identities, trust, and unattended grants — no media or key material. Pairing and
  session rows are short-lived and swept automatically.
- **Secret rotation:** rotating `JWT_SECRET` invalidates issued tokens (clients
  re-authenticate). Rotating `DEVICE_CHALLENGE_SECRET` invalidates in-flight
  challenges. Rotating `TURN_SHARED_SECRET` must be done on coturn and the
  signaling service together.

## Scaling notes

The default in-process presence/session registry assumes a single signaling
instance. To run multiple instances behind a load balancer, add Redis-backed
pub/sub for presence and relay routing (the `Repository` and hub are structured
to allow this) and use sticky sessions for WebSockets.
