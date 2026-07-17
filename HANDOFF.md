# HANDOFF.md — living project handoff

> **RULE FOR EVERY AI SESSION / DEVELOPER: update this file every time anything is done.**
> Whenever you change code, config, docs, or infrastructure — or complete/verify/decide anything —
> update the relevant section(s) below AND add a dated entry to the Session Log at the bottom
> before ending the session. A new chat should be able to read only this file and know exactly
> where the project stands.

_Last updated: 2026-07-17_

---

## 1. What this project is

**AlphaConcept** — a secure, self-hosted **Windows remote-desktop / remote-control application**.
One Electron app runs as either a **host** (screen shared and controlled) or **controller**
(views and controls a paired host). Screen video and input travel **peer-to-peer over WebRTC**
(DTLS/SRTP encrypted). A small **signaling server** (Fastify + WebSocket) only helps paired,
authenticated devices find each other — it never sees screen, keystrokes, or clipboard.

- Current version: **0.1.9**. Owner: Musai (musaisalanssari@gmail.com).
- Not a git repository yet (folder lives in OneDrive).
- Full per-file reference: **`../AlphaConcept-Program-Guide.pdf`** (generated 2026-07-17).
- Detailed changelog with root-cause analyses: `PROJECT_STATE.md`. Conventions/commands: `CLAUDE.md`.

## 2. Folder map (source of truth)

```
remote-desktop/
  .env                  REAL local secrets (gitignored, never share/commit)
  .env.example          placeholder template for every env var
  apps/desktop/         Electron app
    src/main/           trusted side: identity/keys (store.ts), signaling client, IPC,
                        input injection gate (inputController.ts), windows/tray/capture/elevation
    src/preload/        the single narrow contextBridge (window.remoteDesktop)
    src/renderer/       React UI + WebRTC sessions (store.ts, session/, components/, styles.css)
    src/platform/       OS input injection abstraction (Windows = nut-js, fallback = noop)
    out/, release*/     BUILD OUTPUT — never edit
  services/signaling/   the server you will host online
    src/env.ts          validated env (refuses to boot without secrets)
    src/hub.ts          all signaling logic (auth, pairing, sessions, relay, limits)
    src/server.ts       Fastify/WS transport, /healthz, /ice, Origin check, wire codec
    src/repository/     data layer: memory (dev/tests) or prisma (Postgres, production)
  packages/protocol/    Zod message schemas, Ed25519 crypto, coordinates, rate-limit, wire obfuscation
  packages/shared/      log redaction (redact.ts), TURN credential derivation (turn.ts)
  packages/config/      ICE/STUN/TURN config, SERVICE name constant
  infrastructure/       docker-compose (Postgres+signaling+coturn), coturn conf, nginx TLS example,
                        systemd + Windows service wrappers
  scripts/              in-place JS-only update system + admin launcher
  site/ + vercel.json   public static site (site/downloads is PUBLIC once deployed)
  docs/                 architecture, security, protocol, deployment, troubleshooting
  start-signaling.cmd   double-click LAN server launcher (prints ws:// URL to use)
```

## 3. How it works (30-second version)

1. Both apps connect to signaling and authenticate (server challenge → device signs with its
   Ed25519 private key, held encrypted via DPAPI in the Electron main process only).
2. Pairing: host creates a one-time code, controller enters it, both verify fingerprints, host approves.
3. Session: controller sends a signed request → host approves (or unattended auto-accept,
   host-local allow-list) → server hands out STUN + time-limited TURN → peers connect directly.
4. Video host→controller; input controller→host over the "dc" data channel; host re-validates
   every input message (Zod) before injecting via nut-js. Visible indicator + emergency stop
   (Ctrl+Alt+F12) always available. Optional per-connection code proven via HMAC, never transmitted.

## 4. Security posture (verified 2026-07-17)

- Secrets exist **only in `.env`** (gitignored); full-repo scan (incl. builds) found no leaks.
- Server refuses to start without `JWT_SECRET` / `DEVICE_CHALLENGE_SECRET`; no secret defaults.
- TURN shared secret never sent to clients; logs redact tokens/secrets/nonces/codes/IPs.
- Electron: contextIsolation on, nodeIntegration off, strict CSP, narrow typed preload bridge.
- Deliberately excluded: remote shell, keylogging outside sessions, UAC/AV bypass, hidden
  persistence, injected-input-flag spoofing (explicitly declined — see PROJECT_STATE.md).

## 5. Goals

- **Near-term goal: put the signaling server online** (currently LAN-only via `start-signaling.cmd`).
- Long-term: reliable two-machine daily use; possibly macOS/Linux injectors behind `platform/`.

## 6. Task list

### Done
- [x] Full working app v0.1.0–0.1.9: pairing, sessions, remote input, multi-monitor, quality
      controls, unattended access, per-connection codes, wire obfuscation, elevation handling,
      in-place updater, warm-studio UI redesign, generic OS naming. 80 tests green.
- [x] Real two-PC LAN test (2026-07-16): pairing, session, remote mouse/keyboard all worked;
      black-screen race and DPI cursor bugs found and fixed (0.1.1, 0.1.3).
- [x] Full program scan + env-variable leak audit → PASS (2026-07-17); PDF guide generated.
- [x] This HANDOFF.md created (2026-07-17).

### To do (production launch checklist)
- [ ] Deploy signaling behind TLS → **wss://** (use `infrastructure/deployment/nginx.conf.example`).
- [ ] Generate fresh production secrets (do NOT reuse the dev values in `.env`):
      `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- [ ] Set `SIGNALING_ALLOWED_ORIGINS` deliberately (currently `*`).
- [ ] Switch to `SIGNALING_STORE=prisma` + Postgres, strong `POSTGRES_PASSWORD` (compose default is `rdp`), run `db:migrate`.
- [ ] Harden coturn: enable TLS/DTLS, set `--external-ip`, matching `TURN_SHARED_SECRET`.
- [ ] `APP_ENV=production`; confirm both desktop apps point at the new wss:// URL.
- [ ] Confirm video renders on hardware post-0.1.1 fix (last open verification from PROJECT_STATE.md).
- [ ] Consider `git init` + private remote so history/rollback exist before going live.

## 7. Key commands

```bash
pnpm install
pnpm --filter @rdp/protocol --filter @rdp/shared --filter @rdp/config build  # shared libs first
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @rdp/signaling dev      # needs JWT_SECRET + DEVICE_CHALLENGE_SECRET (see .env)
pnpm --filter @rdp/desktop dev
pnpm --filter @rdp/desktop package    # NSIS installer (needs admin/Dev Mode or CI)
scripts\make-update.cmd               # small JS-only update zip for installed copies
```

## 8. Session log (append newest at top — never delete old entries)

### 2026-07-17
- **Shipped v0.1.10 — real-time network priority.**
  - Code: host video encodings now set `networkPriority`/`priority` = 'high',
    `degradationPreference` = 'maintain-framerate', and `contentHint` = 'motion'
    (host.ts:applyEncoding + start); control data channel opened with
    `priority: 'high'` (controller.ts). Typecheck green.
  - New `scripts/Set-AlphaConceptQoS.ps1` + `Enable Real-Time Priority (Admin).cmd`:
    create a Windows Policy-based QoS rule (DSCP 46) for AlphaConcept.exe. Run on
    BOTH PCs. Router must also prioritise DSCP 46 / host IP for internet links.
    Both scripts are now bundled into the update package (make-update.cmd).
  - Published `site/downloads/AlphaConcept-Update-0.1.10.zip` (~163 KB); updates.html
    updated (0.1.10 latest, 0.1.9 demoted). UPDATE-README.txt notes added.
  - Committed + pushed to GitHub (theclasscoder-eng/alphaconcept) → Vercel redeploys.
- Added section 6 to the PDF guide: how to start the signaling server from CMD
  (start-signaling.cmd / pnpm start:local with .env / manual `set` vars / Docker; healthz check).
  PDF is now 12 pages.
- Full codebase scan; environment-variable leak audit → **PASS** (secrets only in gitignored `.env`).
- Generated `../AlphaConcept-Program-Guide.pdf` (11 pages: every file, security table, launch checklist).
- Created this HANDOFF.md with the always-update rule.

### 2026-07-16 (from PROJECT_STATE.md)
- First real two-PC LAN run; fixes 0.1.1–0.1.9 shipped (see PROJECT_STATE.md for full detail).
