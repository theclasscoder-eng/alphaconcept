/**
 * Electron main-process entry point. Bootstraps secure windows, device
 * identity/storage, the signaling client, input injection, tray, and IPC.
 *
 * Testing note: set RDP_USER_DATA to isolate a second instance's data dir and
 * RDP_ALLOW_MULTI=1 to run two instances on one machine (see docs).
 */
import { app, BrowserWindow, clipboard, session } from 'electron';
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
app.setAppUserModelId('com.remotedesktop.app');

// Single-instance unless explicitly allowed (needed for local two-instance tests).
if (!process.env.RDP_ALLOW_MULTI) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  }
}

let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;
let signaling: SignalingClient | null = null;
let input: InputController | null = null;

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
    onClipboard: (text) => {
      if (store.getSettings().clipboardSync) clipboard.writeText(text.slice(0, 256 * 1024));
    },
    onMonitorSelect: (index) => {
      mainWindow?.webContents.send('session:monitor-select', index);
    },
  });

  signaling = new SignalingClient(store);
  applyCsp();
  mainWindow = createMainWindow();

  tray = new AppTray({
    onOpen: () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    },
    onEmergencyStop: () => {
      input?.revoke();
      mainWindow?.webContents.send('session:emergency-stop');
      tray?.setSession(false, null);
    },
    onQuit: () => {
      app.quit();
    },
  });

  registerIpc({
    store,
    signaling,
    input,
    tray,
    getMainWindow: () => mainWindow,
    setSessionActive: (active, name) => tray?.setSession(active, name),
  });
}

app.whenReady().then(bootstrap).catch((err) => {
  console.error('bootstrap failed', err);
  app.quit();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  // Keep running in the tray so the host can accept sessions; quit on non-mac
  // only if the tray is gone.
  if (process.platform !== 'darwin' && !tray) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
});

app.on('before-quit', () => {
  signaling?.disconnect();
  tray?.destroy();
});
