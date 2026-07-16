# PROJECT_STATE

Living status of the implementation. Updated from actual command output.

_Last verified: 2026-07-15 on Windows 11 (Node 24.13.0, pnpm 11.5.3)._

## Completed components

| Component | Status | Notes |
| --- | --- | --- |
| `@rdp/protocol` | ✅ built + tested | Zod signaling/input schemas, Ed25519 identity, coordinate math, token-bucket limiter. Browser-safe subpath (`/browser`) excludes `node:crypto`. |
| `@rdp/shared` | ✅ built + tested | Log redaction, time-limited TURN credential derivation (coturn `use-auth-secret`). |
| `@rdp/config` | ✅ built + tested | Validated ICE/STUN/TURN config, `buildIceServers`. |
| `@rdp/signaling` | ✅ built + tested | Fastify + `@fastify/websocket`; challenge auth, pairing, sessions, WebRTC relay, presence, revocation, rate limits, replay protection. Repository interface with in-memory + Prisma/Postgres impls. |
| `@rdp/desktop` (main) | ✅ built + typechecks | Electron main: secure windows/CSP, device identity via safeStorage (DPAPI), signaling client, input injection (nut-js), capture enumeration, tray + emergency stop, IPC, audit log, stealth (content protection). |
| `@rdp/desktop` (renderer) | ✅ built + typechecks | React + Zustand; dashboard, pairing, incoming-session dialog, controller viewer with input capture, settings; WebRTC host/controller session orchestration. |
| Prisma schema | ✅ validated + client generated | `prisma validate` passes; `prisma generate` OK. |
| Infrastructure | ✅ authored | docker-compose (Postgres + signaling + coturn), coturn config, nginx reverse-proxy example. |
| CI | ✅ authored | GitHub Actions: install/lint/typecheck/test/build + Windows installer job. |
| Docs | ✅ authored | architecture, security, protocol, deployment, troubleshooting. |

## Build status (actual command results)

- `pnpm install` — OK.
- `pnpm lint` — OK (0 errors; 7 `any` warnings in the test-only WS client helper).
- `pnpm typecheck` — OK across all 6 projects (desktop = node + web).
- `pnpm test` — **65 tests pass**: protocol 32, shared 5, config 5, desktop 7, signaling 16.
- `pnpm build` — OK (protocol/shared/config/signaling via tsc; desktop via electron-vite: main+preload+renderer bundles).
- Signaling server boots from `dist`: `/healthz` → `{status:"ok"}`; `/ice` without token → HTTP 401; missing secrets → refuses to start with a clear error.
- `prisma validate` / `prisma generate` — OK.
- nut-js native backend loads on this machine (`Key.A = 72`, `mouse.setPosition` present).
- `electron-builder --dir` — **produced `apps/desktop/release/win-unpacked/Remote Desktop.exe`** (188 MB) containing all bundles and the native `@nut-tree-fork/libnut-win32/.../libnut.node`.

## Confirmed limitations

- **NSIS installer (`.exe`) not produced in this sandbox.** electron-builder extracts its `winCodeSign` cache, which contains macOS symlinks; creating them needs the Windows *SeCreateSymbolicLinkPrivilege* (Administrator or Developer Mode), unavailable to this non-elevated shell. The unpacked app builds fine. Run `pnpm --filter @rdp/desktop package` from an **elevated** terminal or with **Developer Mode** enabled, or let the CI `windows-installer` job (runs on `windows-latest`, which has the privilege) produce it.
- **Two-machine live WebRTC screen + input E2E not executed here.** This environment has no interactive desktop session / second machine to drive the GUI end-to-end. The full manual procedure is documented in `docs/troubleshooting.md` (§ "Two-instance manual test") and `README.md`. All pure logic on that path (coordinate translation, input validation/throttling, message validation, session state) is unit/integration tested.
- **Docker Compose stack not run here** (Docker not installed in this environment). Configuration is authored and documented; the signaling server itself was booted directly from `dist` and verified.
- Windows secure desktop / UAC consent screens, Ctrl+Alt+Del, and DRM-protected video are intentionally **not** controllable (OS protections; see README "Windows limitations").

## Important architectural decisions

- **Data layer behind a `Repository` interface** (in-memory + Prisma). Lets the signaling server run and be integration-tested without Postgres, and keeps Postgres for production.
- **Private key never leaves the main process.** Stored encrypted via Electron `safeStorage` (DPAPI on Windows); the renderer signs nothing directly — session requests are signed in main via a dedicated IPC.
- **Signaling server sees only establishment metadata** — never SDP-carried media, input, or clipboard. Media/input flow peer-to-peer over WebRTC (DTLS/SRTP).
- **Unattended access is a host-LOCAL decision** (allow-list in settings), so the host is always the authority on auto-accept; the server flag is advisory.
- **Stealth = `setContentProtection(true)`** (WDA_EXCLUDEFROMCAPTURE): excludes our own windows from screen capture/recording while staying visible locally. No OS-security bypass.
- **Workspace packages bundled into the Electron main bundle** (not externalized) + `asar: false`, to sidestep electron-builder's rejection of pnpm workspace symlinks outside the app dir.
