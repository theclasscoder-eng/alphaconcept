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
  // BGRA. Green when a session is active, muted blue otherwise.
  const [b, g, r] = active ? [80, 200, 120] : [180, 130, 70];
  for (let i = 0; i < size * size; i++) {
    buf[i * 4 + 0] = b;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = r;
    buf[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export class AppTray {
  private tray: Tray;
  private sessionActive = false;
  private controllerName: string | null = null;

  constructor(private readonly cb: TrayCallbacks) {
    this.tray = new Tray(makeIcon(false));
    this.tray.setToolTip('Remote Desktop');
    this.tray.on('click', () => cb.onOpen());
    this.render();

    // Emergency-disconnect global shortcut.
    globalShortcut.register('CommandOrControl+Alt+F12', () => cb.onEmergencyStop());
  }

  setSession(active: boolean, controllerName: string | null): void {
    this.sessionActive = active;
    this.controllerName = controllerName;
    this.tray.setImage(makeIcon(active));
    this.tray.setToolTip(
      active ? `Remote session active — ${controllerName ?? 'controller'}` : 'Remote Desktop',
    );
    this.render();
  }

  private render(): void {
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: 'Open Remote Desktop', click: () => this.cb.onOpen() },
      { type: 'separator' },
    ];
    if (this.sessionActive) {
      items.push({
        label: `Session active${this.controllerName ? ` — ${this.controllerName}` : ''}`,
        enabled: false,
      });
      items.push({
        label: 'Disconnect now (emergency stop)',
        click: () => this.cb.onEmergencyStop(),
      });
      items.push({ type: 'separator' });
    }
    items.push({ label: 'Quit', click: () => this.cb.onQuit() });
    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  destroy(): void {
    globalShortcut.unregister('CommandOrControl+Alt+F12');
    this.tray.destroy();
  }
}
