AlphaConcept - in-place update
================================

This folder patches an existing AlphaConcept app. You do NOT need to
reinstall or re-copy the whole 287 MB application.

HOW TO APPLY
------------
1. Close the AlphaConcept app (the updater will also close it for you).
2. Double-click:  apply-update.cmd
3. Start the app again.

If it cannot find the app automatically, drag the folder that contains
"AlphaConcept.exe" onto apply-update.cmd, or run:

    apply-update.cmd "C:\path\to\your\app-folder"

WHAT IT DOES
------------
Replaces <app>\resources\app\out with the new build, after backing up the
previous one to <app>\resources\app\out.bak.

ROLLBACK
--------
Delete  <app>\resources\app\out
Rename  <app>\resources\app\out.bak  ->  out

WHAT'S IN THIS UPDATE (0.1.9)
-----------------------------
- REDESIGN: a completely new look and feel ("warm studio"). Cream-paper light
  mode and a warm cocoa-charcoal dark mode replace the old cool-navy scheme,
  with a soft periwinkle accent and pastel status colours (sage / amber / rose).
  Softer rounded cards, calmer shadows, and smooth entrance/transition
  animations that respect the OS "reduce motion" setting.
  * Nothing about how the app works changed - same pairing, sessions, settings,
    security, and shortcuts. This update is presentation only.
  * Light / dark is remembered per device (toggle in the sidebar).
  * This is a JS-only bundle change, so the in-place update applies it fully;
    no reinstall needed.

EARLIER (0.1.8)
-----------------------------
- PRIVACY: nothing identifies this as a remote-control tool outside the app UI.
  * The exe's Task Manager description / company name are now just
    "AlphaConcept" (no "remote", "desktop", "control", "Windows", "WebRTC").
    NOTE: this metadata is baked into the exe, so it only changes with a FULL
    build (release-new\win-unpacked\AlphaConcept.exe) - the JS-only in-place
    update cannot change it.
  * Signaling messages are obfuscated on the wire: message-type names like
    "webrtc.offer" / "session.request" are replaced with opaque codes so a
    packet sniffer can't tell it's a remote session. (Defense-in-depth only -
    for real protection against capture use a wss:// signaling URL.)
- SECURITY: per-connection codes. In Settings, the host can require a secret
  code per paired device. The controller enters it live each session (never
  stored on the controller) and proves it over the encrypted channel before
  input is allowed. A breach of one paired computer can't unlock the others.
- IMPORTANT: because the wire format changed, ALL parts must be on 0.1.8 -
  update BOTH apps and rebuild + restart the signaling server (pnpm build).

EARLIER (0.1.6)
---------------
- RENAMED to "AlphaConcept" (window title, tray, app name, installer). A fresh
  full build produces AlphaConcept.exe; existing "Remote Desktop.exe" copies
  keep their exe name but show the AlphaConcept branding after updating.
- FIX (keyboard/mouse dead on admin apps): the injected input is blocked by
  Windows on windows opened "as administrator" unless the app itself is
  elevated. TWO ways to fix it:
    1) Use "Start AlphaConcept (Admin).cmd" (included here) - it launches the
       app elevated (one UAC prompt). Works with any existing copy.
    2) A fresh full build now marks AlphaConcept.exe as "run as administrator",
       so it always launches elevated.
  Verified end-to-end that keyboard injection itself works; the only blocker on
  admin windows was elevation. NOTE: even elevated, the UAC prompt and the
  lock/login screen still cannot be controlled (separate secure desktops).

EARLIER (0.1.5)
---------------
- FIX/WORKAROUND: the remote mouse did nothing over some programs (Task Manager,
  installers, anything opened "as administrator"). Windows blocks input from a
  normal-privilege app to an elevated window (UIPI) - it is silently dropped.
  The host Dashboard now detects this and offers "Restart as administrator"
  (one UAC prompt); after that the remote mouse works in those programs too.
  If you'd rather not elevate, click "Don't show again" to hide the reminder
  (re-enable it in Settings). NOTE: even as administrator, the UAC consent
  prompt and the lock/login screen still cannot be controlled - those are
  separate Windows secure desktops (by design, not bypassed).

EARLIER (0.1.4)
---------------
- NEW: Settings -> "Hide the on-screen 'Remote session active' banner"
  (behind a warning). When hidden, the tray icon turns RED during a session
  and its tooltip reads "Remote session active", so it stays visible in the
  taskbar's hidden-icons (^) area. History still records every session.
- NEW/CLEARER: the host can end a session instantly with Ctrl+Alt+F12
  (works anywhere, even if the app window is closed to the tray). It cuts
  remote input immediately so you regain control. Also on the tray menu
  ("Disconnect now - regain control") and shown in Settings. If that combo is
  taken by another app, the app falls back to Ctrl+Alt+Q, then Ctrl+Shift+F12,
  and shows you which one is active.

EARLIER (0.1.3)
---------------
- FIX: host cursor landed at the wrong place (e.g. controller at the screen
  edge -> host cursor in the middle) on displays using Windows scaling
  (125/150/200%). Display bounds are reported in logical/DIP pixels, but the
  input injector drives the cursor in physical pixels. Coordinates are now
  converted with Electron's screen.dipToScreenPoint(), which also handles
  multi-monitor setups with mixed scaling.
- NEW: Ctrl+Alt+Shift+R on the controller releases/resumes control at any time.
  The screen stays live; your mouse and keyboard become your own again. There
  is also a "Control: on/off" button in the viewer toolbar.
- FIX: releasing control or Alt+Tabbing away no longer leaves Ctrl/Alt/Shift
  stuck down on the host.

EARLIER (0.1.2)
---------------
- FIX: "A JavaScript error occurred in the main process - TypeError: Object has
  been destroyed" when relaunching the app after closing its window (the app
  keeps running in the tray). Relaunching/clicking the tray now reopens the
  window instead of crashing.

EARLIER (0.1.1)
---------------
- FIX: controller showed a black screen. The host answered the connection
  offer before screen capture had finished starting, so the connection was
  negotiated with no video track. The host now waits for the video track
  before answering.
- FIX: mouse was confined to a small box. With no video, the <video> element
  fell back to its default 300x150 size, and pointer coordinates were mapped
  against that. Mapping now uses the real letterboxed frame area, and input
  is not sent at all until a frame exists.
- NEW: "Waiting for the host's screen..." indicator instead of silent black.
- NEW: host capture failure now ends the session with a clear error instead
  of leaving the controller hanging.
