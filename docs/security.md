# Security model

This is an **authorized remote-administration** tool. It deliberately does not
implement any OS-security bypass, persistence-evasion, or antivirus-evasion
behavior. Every capability requires an authenticated, paired, and (per session)
authorized relationship.

## Identity & authentication

- Each device has an **Ed25519 key pair** generated on first launch. The private
  key is stored **encrypted at rest** via Electron `safeStorage` (DPAPI on
  Windows) and never leaves the main process; it is never exposed to the renderer
  or written in plaintext.
- The device id is the SHA-256 fingerprint of the public key. Knowing an id is
  **not** authentication.
- Every signaling connection must answer a server **challenge**: the server issues
  a MAC-protected, expiring nonce; the device signs the nonce with its private
  key. The server verifies the MAC (it issued this challenge, still fresh),
  marks the nonce **used once** (replay protection), and verifies the signature
  against the registered public key.
- After auth the server issues a short-lived JWT (15 min) used for the ICE-refresh
  endpoint and reconnection.

## Pairing (both parties participate)

1. Host creates a short, single-use pairing code (unambiguous alphabet, expires
   in minutes).
2. Controller enters the code.
3. Both apps display the other device's name and **public-key fingerprint** for
   out-of-band verification.
4. The host explicitly approves; a mutual trust record is created. The code
   cannot be reused.

## Authorization per session

- A `session.request` is **signed** over `sessionId.hostDeviceId`; the server
  verifies it against the controller's registered key and confirms the two
  devices are trusted before forwarding.
- The host either approves interactively or auto-accepts only if the controller
  is on the host's **local unattended allow-list** and incoming connections are
  enabled. The authoritative unattended decision is host-local.
- Input events are accepted only while a session is authorized and are dropped
  immediately on disconnect/emergency stop.

## Unattended access

- **Disabled by default**, enabled per paired controller, clearly explained, and
  revocable at any time. Enabling it never removes the requirement to be paired
  and to prove key possession. Every unattended session still shows the visible
  indicator and is logged locally.

## Revocation

- Revoking a device removes trust and unattended grants (both directions), ends
  any active session between the two, and notifies the peer. A revoked device
  can no longer establish sessions (verified by an integration test).
- "Revoke all devices" clears every pairing and unattended grant at once.

## Transport & data handling

- Media is SRTP; the input/clipboard data channel is DTLS — end-to-end encrypted
  between peers. The signaling server only sees establishment metadata.
- **TURN credentials are time-limited** and derived by the backend from a shared
  secret (coturn `use-auth-secret`); the secret is never sent to clients.
- Signaling WebSocket validates **Origin** and every message against strict Zod
  schemas; unknown versions/types/keys, bad coordinates, impossible key codes,
  stale timestamps, and duplicate message ids are rejected.
- Rate limits apply to overall messages, pairing creation/join, and session
  requests.

## Electron hardening

- `contextIsolation: true`, `nodeIntegration: false`, a strict CSP (set both via
  response headers and a `<meta>` tag), safe external-link handling
  (`setWindowOpenHandler` → OS browser; navigation locked to the app origin).
- The renderer talks only through a **typed, narrow preload bridge** — no raw
  `ipcRenderer`, `fs`, `child_process`, shell, or private keys. Every IPC handler
  re-validates its arguments (Zod) at the trust boundary.

## What we deliberately do NOT do

- No remote shell/terminal, remote process execution, or command execution driven
  by remote input.
- No keylogging outside an active authorized session; typed keys are never stored
  or logged.
- No hidden screen capture; a visible "session active" indicator is always shown
  locally.
- No persistence beyond the explicit, user-visible "Start when I sign in" setting
  (uses the documented Windows login-item mechanism and is removable in-app).
- **No bypass** of UAC, Windows Defender, antivirus, firewalls, or endpoint policy.
- Stealth mode uses `setContentProtection` (WDA_EXCLUDEFROMCAPTURE) to exclude our
  own windows from screen capture/recording only. It does not hide the app from
  the local user, other processes, task manager, or security tooling.

## Logging & privacy

Structured logs are redacted (tokens, secrets, signatures, nonces, pairing codes,
clipboard/text, and IP addresses). The local audit log stores start/end time,
peer name, result, unattended flag, and which side ended — never screen,
clipboard, keystroke, or key material.

## Secrets

No secrets are committed. `.env.example` contains only placeholders. The signaling
service refuses to start without `JWT_SECRET` and `DEVICE_CHALLENGE_SECRET`, and
requires `TURN_SHARED_SECRET` if a TURN URL is configured.
