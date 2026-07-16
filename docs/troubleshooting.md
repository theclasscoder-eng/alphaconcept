# Troubleshooting

## Two-instance manual test (host + controller on one PC)

Run two isolated app instances with separate data dirs. From `apps/desktop`:

```powershell
# Terminal A (host)
$env:RDP_USER_DATA="$env:TEMP\rdp-host";  $env:RDP_ALLOW_MULTI="1"; pnpm dev

# Terminal B (controller)
$env:RDP_USER_DATA="$env:TEMP\rdp-ctl";   $env:RDP_ALLOW_MULTI="1"; pnpm dev
```

(Or launch the packaged `release\win-unpacked\Remote Desktop.exe` twice with the
same two env vars set.) Make sure the signaling stack is running and both windows
show **Signaling: connected**.

Verify, in order:

1. Both devices register (dashboard shows a device id + fingerprint).
2. On the host, **Pair a device → Create a pairing code**.
3. On the controller, **Pair a device → enter the code → Join**.
4. The host sees the approval dialog with the controller's fingerprint → **Approve**.
5. Controller: the host appears under Paired devices (online) → **Connect**.
6. Host: approve the incoming session (or it auto-accepts if unattended is on).
7. The host screen appears in the controller's viewer.
8. Move the mouse — the host cursor follows.
9. Click — the host receives the click.
10. Scroll — the host scrolls.
11. Type into a safe app (e.g. Notepad) on the host — text appears.
12. Switch the shared monitor (host Settings → Shared monitor, or the viewer's
    Monitor menu) — the feed changes.
13. Disconnect (either side, tray, or `Ctrl+Alt+F12`) — capture and input stop
    immediately and the indicator disappears.
14. Revoke the device on one side — a new **Connect** attempt fails ("not trusted").
15. TURN-relay path: set restrictive ICE (see below) and confirm the session still
    connects via the relay.

## Common issues

**"Signaling: error" / can't connect.** Check the Signaling server URL in Settings
(`ws://localhost:8080/ws` for local dev). Confirm the server is up:
`curl http://localhost:8080/healthz`. Check `SIGNALING_ALLOWED_ORIGINS`.

**Server won't start.** It refuses to boot without `JWT_SECRET` and
`DEVICE_CHALLENGE_SECRET`, and without `TURN_SHARED_SECRET` when `TURN_URL` is set.
Read the error — it lists exactly which variables are missing.

**"nut-js unavailable" in the host log / input does nothing.** The native input
module failed to load. Reinstall (`pnpm install` fetches prebuilds), ensure you're
on Windows x64, and check the main-process console. The app still runs; only input
injection is disabled.

**Cursor lands in the wrong place / offset on high-DPI or multi-monitor.**
Coordinates are mapped in the host's logical (DIP) space. For unusual mixed-DPI
multi-monitor setups, try the physical-pixel mapping (see
`packages/protocol/src/coordinates.ts`, `normalizedToPhysicalPoint`).

**Host screen is black in places.** DRM/hardware-protected video (some players,
DRM web content) renders black by OS design; this app does not and must not bypass
that protection.

**Can't control UAC / Ctrl+Alt+Del / the lock screen.** These are Windows secure
surfaces. UAC/secure-desktop and Ctrl+Alt+Del cannot be driven by ordinary input
APIs; the lock screen/pre-login is out of scope for this release. This is expected.

**Connection only works on the same LAN.** You likely have no working TURN. Deploy
coturn with a public `external-ip` and set `TURN_URL`/`TURN_SHARED_SECRET`. Verify
`GET /ice` (with a bearer token) returns a `turn:` server.

**Stealth mode makes the whole viewer black in a recording.** That is the point of
content protection — it excludes the window from capture. To share the host's
screen as if you were local, share on the host and enable stealth there to hide
the indicator/app from the capture, or use the controller's full-screen mode.

## Building the Windows installer fails locally

If `pnpm --filter @rdp/desktop package` fails while extracting `winCodeSign`
("Cannot create symbolic link : A required privilege is not held"), your shell
lacks the Windows *create-symbolic-link* privilege. Run the terminal **as
Administrator**, or enable **Developer Mode** (Settings → Privacy & security → For
developers), then retry. The CI `windows-installer` job builds it on
`windows-latest` without this issue. `package:dir` (unpacked app) does not need
signing tools.
