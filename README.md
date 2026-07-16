# AlphaConcept (Windows-first)

AlphaConcept is a secure, self-hostable remote-control application. One app runs as either a
**host** (its screen is shared and controlled) or a **controller** (views and
controls a paired host). Screen and input travel peer-to-peer over **WebRTC**; a
small **signaling** service only helps paired, authenticated devices connect.

This is an authorized remote-administration tool. It contains **no** OS-security
bypass, persistence-evasion, or antivirus-evasion behavior. See
[`docs/security.md`](docs/security.md).

## Features

- Near-real-time full-screen capture over WebRTC while normal apps run.
- Remote mouse move/click/drag/scroll, keyboard, modifiers, shortcuts, text.
- Works across networks via WebRTC ICE with configurable **STUN** and **TURN**
  (time-limited TURN credentials issued by the backend).
- Cryptographic device identity (Ed25519); **mutual pairing** with fingerprint
  verification; per-session authorization.
- **Unattended access**, disabled by default, enabled per device, revocable.
- Always-visible "session active" indicator; emergency-stop shortcut, tray, and
  disconnect.
- **Stealth**: exclude the app's own windows from screen recording/sharing
  (still visible to you locally) — no security bypass.
- Multi-monitor selection and live switching; quality (Low/Balanced/High) and
  frame-rate (15/30/60) controls; adaptive bitrate.
- Text-only, opt-in clipboard sync; local, non-sensitive session history.
- Secure Electron config (context isolation, no node integration, CSP, typed
  preload bridge).

## Repository layout

```
apps/desktop         Electron app (React renderer, Node main, preload)
services/signaling   Fastify signaling service (+ Prisma, tests)
packages/protocol    Zod message schemas, Ed25519 identity, coordinate math
packages/shared      Log redaction, TURN credential derivation
packages/config      ICE/STUN/TURN config
infrastructure       docker-compose, coturn, nginx example
docs                 architecture / security / protocol / deployment / troubleshooting
```

## Prerequisites

- Node.js ≥ 20 (developed on 24), pnpm 11.
- Windows 11 x64 for the desktop app (input injection uses a Windows native module).
- Docker + Compose for the full local backend (optional — a zero-dependency
  in-memory signaling mode is available for quick starts).

## Quick start (development)

```bash
pnpm install

# Build the shared workspace packages once.
pnpm --filter @rdp/protocol --filter @rdp/shared --filter @rdp/config build
```

### Option A — zero-dependency signaling (no Docker)

```bash
# Terminal 1: run the signaling service with the in-memory store.
cd services/signaling
# PowerShell:
$env:SIGNALING_STORE="memory"
$env:JWT_SECRET="dev-jwt-secret-please-change-000000"
$env:DEVICE_CHALLENGE_SECRET="dev-challenge-secret-change-000000"
pnpm dev            # listens on ws://localhost:8080/ws
```

### Option B — full stack (Postgres + signaling + coturn) via Docker

```bash
cp .env.example .env   # then fill in strong secrets (see docs/deployment.md)
docker compose -f infrastructure/docker-compose.yml up -d
pnpm --filter @rdp/signaling db:migrate   # if running the server outside Docker
```

### Run the desktop app

```bash
# Terminal 2:
pnpm --filter @rdp/desktop dev
```

The default Signaling server URL is `ws://localhost:8080/ws` (change it in
Settings). Health check: `curl http://localhost:8080/healthz`.

## Run two instances on one machine (host + controller)

```powershell
# Host
$env:RDP_USER_DATA="$env:TEMP\rdp-host"; $env:RDP_ALLOW_MULTI="1"; pnpm --filter @rdp/desktop dev
# Controller (second terminal)
$env:RDP_USER_DATA="$env:TEMP\rdp-ctl";  $env:RDP_ALLOW_MULTI="1"; pnpm --filter @rdp/desktop dev
```

Full step-by-step verification: [`docs/troubleshooting.md`](docs/troubleshooting.md).

## How to pair two computers

1. On the **host**, open **Pair a device → Create a pairing code**.
2. On the **controller**, open **Pair a device**, type the code, click **Join**.
3. Both show the other device's **fingerprint** — verify they match.
4. The host clicks **Approve** (optionally ticking "Allow unattended access").
5. The controller now sees the host under **Paired devices**. Click **Connect**;
   the host approves (or auto-accepts if unattended); the screen appears.

## How to enable unattended access

- At pairing time: tick **"Allow unattended access from this device"** in the
  host's approval dialog, **or**
- Later: Dashboard/Settings → toggle **Unattended** for that paired device.

It is disabled by default, applies per device, is revocable anytime, and every
unattended session still shows the visible indicator and is logged. The device
must still be paired and prove possession of its private key. For the initial
release, unattended access requires the host to remain signed in to Windows.

Optional: **Settings → Start when I sign in** uses the documented Windows
login-item mechanism; it is off by default and removable in-app.

## Create the Windows installer

```bash
pnpm --filter @rdp/desktop package        # NSIS installer -> apps/desktop/release/*.exe
pnpm --filter @rdp/desktop package:dir     # unpacked app  -> apps/desktop/release/win-unpacked/
```

If `package` fails extracting `winCodeSign` ("a required privilege is not held"),
run the terminal **as Administrator** or enable **Developer Mode**, or use the CI
`windows-installer` job. See [`docs/troubleshooting.md`](docs/troubleshooting.md).

## Windows limitations (by design — not bypassed)

- The Windows **secure desktop** and **UAC** consent screens cannot be remotely
  controlled.
- **Ctrl+Alt+Del** cannot be simulated through ordinary input APIs.
- **DRM/hardware-protected** video may appear black.
- **Lock-screen / pre-login** access is out of scope for this release (would
  require a properly installed, signed Windows service).

## Scripts

```bash
pnpm lint            # ESLint
pnpm typecheck       # tsc across all projects
pnpm test            # Vitest (protocol, shared, config, signaling, desktop)
pnpm build           # build all packages + desktop bundles
pnpm --filter @rdp/signaling test    # backend integration tests
pnpm --filter @rdp/desktop build     # electron-vite bundles
```

## Documentation

- [Architecture](docs/architecture.md)
- [Security model](docs/security.md)
- [Protocol](docs/protocol.md)
- [Deployment](docs/deployment.md)
- [Troubleshooting & manual test](docs/troubleshooting.md)
- [Project status](PROJECT_STATE.md)

## License

Provided as-is for authorized remote administration and educational use.
