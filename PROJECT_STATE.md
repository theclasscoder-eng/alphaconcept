# PROJECT_STATE

Living status of the implementation. Updated from actual command output.

_Last verified: 2026-07-16 on Windows 11 (Node 24.13.0, pnpm 11.5.3)._

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

## Real two-machine run (user-executed, 2026-07-16, LAN via iPhone hotspot)

First live host↔controller test on two physical Windows PCs.

**Worked:** signaling connect on both, pairing + fingerprint approval, session
request/approve, ICE/DTLS connect, data channel, **remote mouse/keyboard input**.

**Failed → FIXED in 0.1.1:**

1. **Controller saw only a black screen.** Root cause: a race in `HostSession`.
   The controller sends its offer immediately on approval, but the host's
   `getUserMedia` screen capture takes ~100–500 ms. `onOffer` answered before
   `addTrack()` ran, so the answer negotiated **no video track** — connection
   succeeded (input worked) but no media ever flowed. Fixed by gating `onOffer`
   on a `captureReady` promise resolved after tracks are attached.
   Regression-tested in `src/renderer/session/host.test.ts` (verified the tests
   fail with the fix removed: `expected 4 to be less than 0`).
2. **Mouse confined to a small box.** Downstream of (1): with no stream, the
   `<video>` element falls back to its default 300×150 intrinsic size, and the
   viewer mapped pointer coords against the element rect. Now the viewer uses
   the tested `computeContentRect`/`viewerPixelToNormalized` helpers against the
   real letterboxed frame area (`object-fit: contain`), and sends no input at all
   until a frame exists.
3. Added a "Waiting for the host's screen…" state (black is never silent now) and
   host capture failure ends the session with an error instead of hanging.

**Still to confirm on hardware:** that video actually renders after 0.1.1.

### 0.1.2 — main-process crash: "TypeError: Object has been destroyed"

Reported from a real launch (`App.emit` in the stack = an `app.on(...)` handler).

Root cause: closing the main window does not quit the app (it stays in the tray
so the host can accept sessions), but `mainWindow` was **never cleared**, so it
kept referencing a destroyed `BrowserWindow`. Six unguarded call sites; the crash
path was `app.on('second-instance')` → `mainWindow.isMinimized()` after the window
had been closed and the app relaunched.

Fixed: `liveMainWindow()` / `ensureMainWindow()` / `focusMainWindow()` helpers,
`win.on('closed')` clears the reference, a liveness-checked `send()` in ipc.ts,
destroyed-guards in `AppTray` (incl. idempotent `destroy()`), a `closed` handler
for the indicator window, and the single-instance loser no longer bootstraps.
Behaviour also improved: relaunching / clicking the tray now **recreates** the
window instead of doing nothing.

Verified on hardware: launched the packaged app, closed the window (app stayed in
the tray, 3 processes), relaunched → **no crash, window recreated** (same PID).

### 0.1.3 — cursor misaligned on high-DPI hosts + release-control shortcut

**Bug (user-reported):** controller pointer at the far edge put the host cursor at
the screen centre — a 2x factor on a 200%-scaled host.

Root cause: **DIP vs physical pixels.** Electron's `screen` API reports display
bounds in DIP (a 2560x1600 display at 200% reports 1280x800, scaleFactor 2), but
nut-js runs inside the DPI-*aware* Electron process and drives the cursor in
physical pixels. Feeding it DIP made the cursor reach only 1/scaleFactor of the
screen.

Measured inside Electron on the dev box (this is the decisive evidence):

| source | value |
| --- | --- |
| `screen` bounds / scaleFactor | 1280x800, 2 |
| `screen.dipToScreenPoint(1280,800)` | 2560x1600 |
| nut-js screen size **in Electron** | **2560x1600** (physical) |
| nut-js screen size **in plain Node** | 1280x800 (DPI-virtualized — misleading!) |

Note the last row: probing nut-js from Node gives the *opposite* answer, because
DPI virtualization is per-process. Always probe inside Electron.

Fixed by injecting `screen.dipToScreenPoint` into `InputController`
(`dipToScreenPoint` option), which also handles multi-monitor mixed-DPI correctly
— a naive `* scaleFactor` does not. The controller stays Electron-free/testable.
Regression-tested (verified failing with the fix removed:
`expected [ 'moveTo', 1280, 800 ] to deeply equal [ 'moveTo', 2560, 1600 ]`).

**Feature:** `Ctrl+Alt+Shift+R` on the controller releases/resumes input without
ending the session (screen stays live). Also a "Control: on/off" toolbar button
(always visible, even when the toolbar is collapsed). Releasing control — and
window blur (Alt+Tab) — now sends key-up for every held key, preventing stuck
modifiers on the host.

### 0.1.4 — hideable on-screen banner + discoverable host end-shortcut

**Feature (user-requested):** the large red overlay defeated the purpose when the
host is demoing/sharing. Added Settings → "Hide the on-screen banner" behind a
warning modal. When hidden, the **tray icon turns red** during a session with a
"Remote session active" tooltip, so it stays visible in the taskbar hidden-icons
area (the persistent indicator). Session history still records everything.
Enabling mid-session hides the banner immediately (tray stays); disabling applies
next session.

**Feature (user-requested):** surfaced the host instant-end shortcut. It already
existed (`Ctrl+Alt+F12`, global) but was undiscoverable and could fail silently.
Now registered robustly with fallbacks (`Ctrl+Alt+Q`, `Ctrl+Shift+F12`), the
active combo is shown in Settings, the tray menu, and the overlay, and it's the
"emergency stop": `input.revoke()` cuts injection instantly (control regained
immediately) and the session tears down. Verified at runtime that the primary
accelerator registers (no fallback warning) and the app launches without crash.

### 0.1.5 — remote mouse blocked over elevated (admin) windows

**Bug (user-reported):** remote mouse froze over "certain programs" — the local
mouse worked, the remote one didn't, only over those windows.

Root cause: **Windows UIPI.** A medium-integrity (normal) process cannot SendInput
to a higher-integrity (elevated/admin) window; Windows drops it silently, so
nut-js "succeeds" but nothing happens. Affects Task Manager, installers, and any
app launched "as administrator". Confirmed the dev host runs non-elevated
(`WindowsPrincipal.IsInRole(Administrator)` → False).

Fix: `system.ts` detects elevation (authoritative token check via PowerShell,
`net session` fallback) and `relaunchElevated()` re-launches via
`Start-Process -Verb RunAs` (UAC prompt; passes `--allow-multi` so the elevated
instance skips the single-instance lock during handover; old instance exits on
success, stays put on cancel). Host Dashboard shows an elevation card:
green "Running as administrator / Full control" when elevated, else an amber
warning with "Restart as administrator" and a "Don't show again" flag
(`hideAdminWarning` setting, re-enableable in Settings). Documented that UAC
consent and the lock/login secure desktops remain uncontrollable by design.
Verified: built app launches clean, elevation IPC + check + card all shipped.

### 0.1.6 — keyboard/mouse dead on admin apps + rename to AlphaConcept

**Keyboard bug (user-reported):** after elevating fixed the mouse, keyboard/mouse
still didn't work on admin programs. **Proved keyboard injection works** end-to-end
(nut-js typed `hi99` into Notepad, then Ctrl+A/Ctrl+C, read back from clipboard →
`KEYBOARD WORKS`). So the code is fine; the admin-window block is purely UIPI
elevation. Key insight: the cursor *moving* over an admin window never proves
elevation (movement isn't blocked) — only clicks/keys are — so the earlier "mouse
worked" likely wasn't truly elevated. Two robust fixes shipped:
1. `Start AlphaConcept (Admin).cmd` — launches the app elevated (one UAC prompt);
   works with any existing copy (in-place-update path).
2. `win.requestedExecutionLevel: requireAdministrator` — the packaged exe now
   always runs elevated. Verified the built `AlphaConcept.exe` manifest contains
   `requireAdministrator`.

**Rename:** product renamed **Remote Desktop → AlphaConcept** across app identity
(appId `com.alphaconcept.app`, AppUserModelID, window title, tray, brand),
electron-builder (`productName`, exe `AlphaConcept.exe`), launcher/updater scripts
(updater finds both old and new exe names), README/docs. Internal package scope
`@rdp/*` intentionally kept (not user-facing; renaming it is a churny no-value
refactor). Full rebuild succeeded → `AlphaConcept.exe`; note the exe rename means
the OTHER PC needs a full folder copy (not the JS-only in-place update) to get the
new name + requireAdministrator manifest — or it can keep the old exe + the admin
launcher.

### 0.1.8 — generic OS/network identity + per-connection codes

Three user-requested security asks:

1. **Generic OS metadata.** Task Manager's "Description" reads the exe
   `FileDescription`, which electron-builder set from package.json `description`
   (and `CompanyName` from `author`) — both leaked "remote/desktop/control".
   Verified by reading the built exe's version info. Set `description` and
   `author` to just "AlphaConcept"; a fresh build's exe now reports
   FileDescription/ProductName/CompanyName = "AlphaConcept" with no leak
   (verified). Baked into the exe, so requires a full rebuild (not JS update).

2. **Wire obfuscation.** Signaling is `ws://` on LAN, so type names like
   "webrtc.offer" were readable by a sniffer. Added `wire.ts` codec (deterministic
   opaque code per type + shortened envelope keys) applied at both transport ends
   (`server.ts`, desktop `signaling.ts`); tested round-trip + collision-free +
   still schema-valid, and the 16 WS integration tests pass with it live.
   Documented honestly as obfuscation, not encryption — WSS is the real fix.

3. **Per-connection codes.** Host stores a per-controller secret (encrypted via
   safeStorage), controller enters it live (never stored controller-side) and
   proves it via `HMAC-SHA256(code, sessionId)` over the DTLS data channel;
   host defers input authorization until verified; 3 strikes ends the session.
   Cross-checked that the controller's Web Crypto proof equals the host's
   node:crypto proof (proof.test.ts) — critical for interop. UI: host sets codes
   per device in Settings; controller gets a live unlock prompt.

Note: the wire-format change means server + both apps must all be on 0.1.8.
Data channel label generic-ized ('rdp-control' → 'dc'). 80 tests total.

### 0.1.9 — UI redesign ("warm studio"), presentation-only

Full visual redesign to remove the generic look, per user request: creamy /
pastel, human, professional, smooth animations, both light and dark themes.

- Rewrote `apps/desktop/src/renderer/styles.css` as a token-driven system with a
  new palette: warm cream-paper light mode + warm cocoa-charcoal dark mode
  (replacing the previous cool-navy scheme), a soft periwinkle accent used
  sparingly, and pastel semantic colours (sage `--ok`, amber `--warn`/`--amber`,
  rose `--bad`). Softer radii, warmer shadows, entrance/tab/toast/modal
  animations gated behind `prefers-reduced-motion`.
- **No component logic touched** — every existing class name, store selector, and
  handler is unchanged; this is purely CSS tokens + rules. Added an `--amber`
  alias used by `ElevationCard`.
- Verified the design system standalone over HTTP with a temporary
  `__preview.html` (since deleted): computed-style + WCAG contrast checks in both
  themes — primary text 11–13:1, secondary >5:1, accents pass AA-large.
- Gate green: `pnpm lint` 0 errors (7 pre-existing test-helper `any` warnings),
  `pnpm typecheck` all projects, `pnpm test` 72 tests pass, `pnpm --filter
  @rdp/desktop build` OK. JS/CSS-only, so the in-place update applies it fully
  (no exe rebuild required for this change).

### Injected-input flag spoofing — DECLINED (not implemented)

Request: make injected mouse/keyboard events not carry `LLMHF_INJECTED`
(`MSLLHOOKSTRUCT.flags` / `KBDLLHOOKSTRUCT.flags`) so apps that block synthetic
input accept it. Declined: that flag is a Windows integrity signal set
automatically by SendInput; clearing it requires a kernel HID/injection driver
whose purpose is disguising synthetic input as hardware — i.e. anti-cheat /
anti-automation **detection evasion**, which this project's charter and the
assistant's guidelines forbid. No legitimate remote tool hides it; apps blocking
it do so intentionally. (Distinct from the earlier UIPI/elevation fix, which was
legitimate.)

### Service wrapper naming — DONE

Added `SERVICE = { name, displayName, description: 'AlphaConcept' }` to
`packages/config` as the single source of truth. Provided visible, removable
service wrappers for the (headless) signaling server, all named "AlphaConcept":
`infrastructure/deployment/alphaconcept.service` (systemd) and
`infrastructure/deployment/windows-service/*` (NSSM-based install/uninstall +
README). The desktop GUI app is not run as a service (session-0 isolation).

## In-place update mechanism

Because `asar: false`, app code is plain files at `<app>\resources\app\out`. A
build produces a ~600 KB (140 KB zipped) update package via
`scripts\make-update.cmd`; `scripts\apply-update.ps1` swaps it in, backing up the
old build to `out.bak`. Verified against `release\win-unpacked` (0.1.0 → 0.1.1,
new code present, rollback backup created). No reinstall required.

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
