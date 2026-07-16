/**
 * Electron main-process entry point. Bootstraps secure windows, device
 * identity/storage, the signaling client, input injection, tray, and IPC.
 *
 * Window lifetime: closing the main window does NOT quit the app — it keeps
 * running in the tray so the host can still accept sessions. That means
 * `mainWindow` can refer to a destroyed window at any time, so every access
 * goes through `liveMainWindow()` / `focusMainWindow()`. Touching a destroyed
 * BrowserWindow throws "Object has been destroyed" and crashes the app.
 *
 * Testing note: set RDP_USER_DATA to isolate a second instance's data dir and
 * RDP_ALLOW_MULTI=1 to run two instances on one machine (see docs).
 */
import { app, BrowserWindow, clipboard, screen, session } from 'electron';
import { Store } from './store.js';
import { SignalingClient } from './signaling.js';
import { InputController } from './inputController.js';
import { createInputInjector } from '../platform/index.js';
import { createMainWindow } from './windows.js';
import { AppTray } from './tray.js';
import { registerIpc } from './ipc.js';

// Allow overriding the data dir (used to run a second isolated instance).
if (process.env.RDP_USER_DATA) {
  app.setPath('userData', process.env.RDP_USER_DATA);
}
app.setAppUserModelId('com.alphaconcept.desktop');

let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;
let signaling: SignalingClient | null = null;
let input: InputController | null = null;

/** The main window, or null if it does not exist / has been destroyed. */
function liveMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** Create the main window if needed, tracking its destruction. */
function ensureMainWindow(): BrowserWindow {
  const live = liveMainWindow();
  if (live) return live;
  const win = createMainWindow();
  // Clear the reference as soon as it is gone, so we never touch a dead window.
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
  return win;
}

/** Bring the window to the front, recreating it if it was closed to the tray. */
function focusMainWindow(): void {
  const win = ensureMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Send to the renderer only if it is actually alive. */
function sendToRenderer(channel: string, payload?: unknown): void {
  const win = liveMainWindow();
  if (!win || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function applyCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
            "script-src 'self'; " +
            // Vite dev injects inline styles; media/blob for WebRTC video.
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; " +
            "media-src 'self' blob: mediastream:; " +
            "connect-src 'self' ws: wss: https:; " +
            "font-src 'self' data:; " +
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        ],
      },
    });
  });
}

async function bootstrap(): Promise<void> {
  const store = new Store();

  // Sync OS login item with the stored preference.
  try {
    app.setLoginItemSettings({ openAtLogin: store.getSettings().startOnLogin });
  } catch {
    /* non-fatal on unsupported platforms */
  }

  // Input injection (host side).
  const { injector, error } = await createInputInjector();
  if (error) console.warn('[input]', error);
  input = new InputController({
    injector,
    // nut-js drives the cursor in PHYSICAL pixels inside the DPI-aware Electron
    // process, while display bounds are reported in DIP. Without this the cursor
    // only reaches 1/scaleFactor of the screen (e.g. half at 200% scaling).
    dipToScreenPoint: (p) => screen.dipToScreenPoint(p),
    onClipboard: (text) => {
      if (store.getSettings().clipboardSync) clipboard.writeText(text.slice(0, 256 * 1024));
    },
    onMonitorSelect: (index) => {
      sendToRenderer('session:monitor-select', index);
    },
  });

  signaling = new SignalingClient(store);
  applyCsp();
  ensureMainWindow();

  tray = new AppTray({
    onOpen: () => focusMainWindow(),
    onEmergencyStop: () => {
      // Stop OS input immediately, then tell the renderer to tear the session down.
      input?.revoke();
      sendToRenderer('session:emergency-stop');
      tray?.setSession(false, null);
    },
    onQuit: () => app.quit(),
  });

  registerIpc({
    store,
    signaling,
    input,
    tray,
    getMainWindow: liveMainWindow,
    setSessionActive: (active, name) => tray?.setSession(active, name),
  });
}

// Single-instance unless explicitly allowed (local two-instance tests, or the
// elevated-relaunch handover which passes --allow-multi).
const allowMulti = !!process.env.RDP_ALLOW_MULTI || process.argv.includes('--allow-multi');
const hasLock = allowMulti ? true : app.requestSingleInstanceLock();

if (!hasLock) {
  // Another instance owns the lock: hand off and exit without bootstrapping.
  app.quit();
} else {
  app.whenReady().then(bootstrap).catch((err) => {
    console.error('bootstrap failed', err);
    app.quit();
  });

  // A second launch focuses the existing window (recreating it if it was
  // closed to the tray) instead of starting another copy.
  app.on('second-instance', () => {
    focusMainWindow();
  });

  app.on('activate', () => {
    focusMainWindow();
  });

  app.on('window-all-closed', () => {
    // Keep running in the tray so the host can accept sessions. Only quit if
    // there is no tray to get back in through.
    if (process.platform !== 'darwin' && !tray) app.quit();
  });

  app.on('before-quit', () => {
    signaling?.disconnect();
    tray?.destroy();
    tray = null;
  });
}
