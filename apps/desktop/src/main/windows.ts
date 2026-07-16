/**
 * Window management: the main application window and a small always-on-top
 * "Remote session active" indicator overlay.
 *
 * Stealth mode uses Electron's `setContentProtection(true)`, which on Windows
 * calls SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE). This excludes the
 * window from screen capture / recording / sharing (e.g. Zoom) WITHOUT hiding
 * it from the local user and WITHOUT any OS-security bypass. It only affects how
 * our OWN windows are captured — it never hides other applications or processes.
 */
import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

const isDev = !!process.env.ELECTRON_RENDERER_URL;

function rendererEntry(hash: string): { url?: string; file?: string; hash: string } {
  if (process.env.ELECTRON_RENDERER_URL) {
    return { url: process.env.ELECTRON_RENDERER_URL, hash };
  }
  return { file: join(__dirname, '../renderer/index.html'), hash };
}

const PRELOAD = join(__dirname, '../preload/index.cjs');

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    title: 'AlphaConcept',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload uses Node builtins via the bridge; renderer stays isolated
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Open external links in the OS browser; never navigate the app window away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const entry = process.env.ELECTRON_RENDERER_URL;
    if (entry && url.startsWith(entry)) return;
    event.preventDefault();
  });

  const entry = rendererEntry('/');
  if (entry.url) void win.loadURL(entry.url);
  else void win.loadFile(entry.file!);

  return win;
}

let indicatorWindow: BrowserWindow | null = null;

export function showIndicator(controllerName: string, unattended: boolean, stealth: boolean): void {
  if (indicatorWindow && !indicatorWindow.isDestroyed()) {
    indicatorWindow.webContents.send('indicator:update', { controllerName, unattended });
    indicatorWindow.setContentProtection(stealth);
    return;
  }
  const win = new BrowserWindow({
    width: 320,
    height: 96,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // Stealth: exclude the indicator from screen capture when requested.
  win.setContentProtection(stealth);

  const entry = rendererEntry('/indicator');
  if (entry.url) void win.loadURL(`${entry.url}#/indicator`);
  else void win.loadFile(entry.file!, { hash: '/indicator' });

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.showInactive();
    win.webContents.send('indicator:update', { controllerName, unattended });
  });
  // Never keep a reference to a destroyed window.
  win.on('closed', () => {
    if (indicatorWindow === win) indicatorWindow = null;
  });
  indicatorWindow = win;
}

export function hideIndicator(): void {
  if (indicatorWindow && !indicatorWindow.isDestroyed()) indicatorWindow.close();
  indicatorWindow = null;
}

/** Apply stealth (content protection) to the main window as well. */
export function setMainStealth(win: BrowserWindow, enabled: boolean): void {
  win.setContentProtection(enabled);
}

export { isDev };
