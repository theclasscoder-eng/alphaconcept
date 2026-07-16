/**
 * System tray with a session-aware menu and an emergency-disconnect action.
 * The tray icon is generated from a raw bitmap so no binary asset is required.
 */
import { Tray, Menu, nativeImage, globalShortcut, type NativeImage } from 'electron';

export interface TrayCallbacks {
  onOpen: () => void;
  onEmergencyStop: () => void;
  onQuit: () => void;
}

function makeIcon(active: boolean): NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  // BGRA. RED when a session is active (clear "being controlled" signal in the
  // tray, especially when the on-screen overlay is hidden); muted blue at rest.
  const [b, g, r] = active ? [60, 70, 240] : [180, 130, 70];
  for (let i = 0; i < size * size; i++) {
    buf[i * 4 + 0] = b;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = r;
    buf[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

/**
 * Register the emergency-stop global shortcut, trying a few accelerators in case
 * the preferred one is already taken by another app. Returns the human-readable
 * combo that actually registered, or a message if none did (the tray menu and
 * in-app Disconnect button still work regardless).
 */
const SHORTCUT_CANDIDATES: Array<[accelerator: string, label: string]> = [
  ['CommandOrControl+Alt+F12', 'Ctrl+Alt+F12'],
  ['CommandOrControl+Alt+Q', 'Ctrl+Alt+Q'],
  ['CommandOrControl+Shift+F12', 'Ctrl+Shift+F12'],
];

function registerEmergencyShortcut(handler: () => void): { accelerator: string; label: string } {
  for (const [accelerator, label] of SHORTCUT_CANDIDATES) {
    try {
      if (globalShortcut.register(accelerator, handler) && globalShortcut.isRegistered(accelerator)) {
        return { accelerator, label };
      }
    } catch {
      /* try the next candidate */
    }
  }
  console.warn('[tray] could not register any emergency-stop shortcut');
  return { accelerator: '', label: 'the tray menu (Disconnect now)' };
}

export class AppTray {
  private tray: Tray;
  private sessionActive = false;
  private controllerName: string | null = null;
  /** Human-readable emergency-stop combo actually registered (shown in the UI). */
  readonly shortcutLabel: string;
  private readonly accelerator: string;

  constructor(private readonly cb: TrayCallbacks) {
    this.tray = new Tray(makeIcon(false));
    this.tray.on('click', () => cb.onOpen());

    const reg = registerEmergencyShortcut(() => cb.onEmergencyStop());
    this.shortcutLabel = reg.label;
    this.accelerator = reg.accelerator;

    this.tray.setToolTip('AlphaConcept');
    this.render();
  }

  setSession(active: boolean, controllerName: string | null): void {
    if (this.tray.isDestroyed()) return;
    this.sessionActive = active;
    this.controllerName = controllerName;
    this.tray.setImage(makeIcon(active));
    this.tray.setToolTip(
      active
        ? `⬤ REMOTE SESSION ACTIVE — ${controllerName ?? 'controller'}\nPress ${this.shortcutLabel} to end`
        : 'AlphaConcept',
    );
    this.render();
  }

  private render(): void {
    if (this.tray.isDestroyed()) return;
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: 'Open AlphaConcept', click: () => this.cb.onOpen() },
      { type: 'separator' },
    ];
    if (this.sessionActive) {
      items.push({
        label: `● Remote session active${this.controllerName ? ` — ${this.controllerName}` : ''}`,
        enabled: false,
      });
      items.push({
        label: `Disconnect now — regain control  (${this.shortcutLabel})`,
        accelerator: this.accelerator || undefined,
        click: () => this.cb.onEmergencyStop(),
      });
      items.push({ type: 'separator' });
    }
    items.push({ label: 'Quit', click: () => this.cb.onQuit() });
    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  /** Safe to call more than once (e.g. before-quit after an explicit quit). */
  destroy(): void {
    if (this.accelerator) globalShortcut.unregister(this.accelerator);
    if (!this.tray.isDestroyed()) this.tray.destroy();
  }
}
