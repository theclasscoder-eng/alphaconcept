/**
 * Registers all IPC handlers. This is the ONLY bridge between the isolated
 * renderer and the main process. Every handler validates/normalizes its inputs;
 * no raw Node, fs, shell, or child_process capability is exposed.
 */
import { ipcMain, app, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { clientMessage, PROTOCOL_VERSION, randomId } from '@rdp/protocol';
import type { Store } from './store.js';
import type { SignalingClient } from './signaling.js';
import type { InputController } from './inputController.js';
import { listMonitors } from './capture.js';
import { showIndicator, hideIndicator, setMainStealth } from './windows.js';
import type { AppTray } from './tray.js';
import type {
  ActiveDisplay,
  AuditEntry,
  IndicatorInfo,
  OutgoingSignal,
  PairedDevice,
} from '../shared-app/types.js';

export interface IpcContext {
  store: Store;
  signaling: SignalingClient;
  input: InputController;
  tray: AppTray;
  getMainWindow: () => BrowserWindow | null;
  setSessionActive: (active: boolean, controllerName: string | null) => void;
}

const activeDisplaySchema = z.object({
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  scaleFactor: z.number().positive(),
});

const pairedDeviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  fingerprint: z.string().max(128),
  unattended: z.boolean(),
  addedAt: z.number(),
  online: z.boolean().optional(),
  available: z.boolean().optional(),
});

const settingsPatchSchema = z
  .object({
    deviceName: z.string().min(1).max(128),
    signalingUrl: z.string().min(1).max(2048),
    stunUrl: z.string().max(2048),
    turnUrl: z.string().max(2048),
    allowIncoming: z.boolean(),
    startOnLogin: z.boolean(),
    clipboardSync: z.boolean(),
    quality: z.enum(['low', 'balanced', 'high']),
    frameRate: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    unattendedDeviceIds: z.array(z.string()).max(1000),
  })
  .partial();

let stealthEnabled = false;

export function registerIpc(ctx: IpcContext): void {
  const { store, signaling, input } = ctx;

  // Forward signaling messages and state to the renderer.
  signaling.on('message', (msg) => {
    ctx.getMainWindow()?.webContents.send('signaling:message', msg);
  });
  signaling.on('state', (state) => {
    ctx.getMainWindow()?.webContents.send('signaling:state', state);
  });

  // ---- device ----
  ipcMain.handle('device:getIdentity', () => store.getPublicIdentity());
  ipcMain.handle('device:setName', (_e, name: unknown) => {
    return store.setDeviceName(z.string().parse(name));
  });

  // ---- signaling ----
  ipcMain.handle('signaling:getState', () => signaling.getState());
  ipcMain.handle('signaling:connect', () => signaling.connect());
  ipcMain.handle('signaling:disconnect', () => signaling.disconnect());
  ipcMain.handle('signaling:send', (_e, message: unknown) => {
    // Validate by reconstructing a full client message and parsing it.
    const identity = store.getPublicIdentity();
    const candidate = {
      v: PROTOCOL_VERSION,
      id: 'ipc',
      ts: Date.now(),
      from: identity.deviceId,
      ...(message as object),
    };
    const parsed = clientMessage.safeParse(candidate);
    if (!parsed.success) throw new Error('invalid signaling message');
    signaling.send(message as OutgoingSignal);
  });

  ipcMain.handle('signaling:requestSession', (_e, hostId: unknown) => {
    const host = z.string().min(1).max(128).parse(hostId);
    const sessionId = randomId();
    const signature = store.sign(`${sessionId}.${host}`);
    signaling.send({ type: 'session.request', toDeviceId: host, sessionId, signature });
    return sessionId;
  });

  // ---- capture ----
  ipcMain.handle('capture:listMonitors', () => listMonitors());

  // ---- session ----
  ipcMain.handle('session:setActiveDisplay', (_e, display: unknown) => {
    const d = activeDisplaySchema.parse(display) as ActiveDisplay;
    input.authorize(d);
  });
  ipcMain.handle('session:injectControl', async (_e, raw: unknown) => {
    const result = await input.handle(raw);
    return result === 'injected' || result === 'accepted';
  });
  ipcMain.handle('session:setStealth', (_e, enabled: unknown) => {
    stealthEnabled = z.boolean().parse(enabled);
    const win = ctx.getMainWindow();
    if (win) setMainStealth(win, stealthEnabled);
  });
  ipcMain.handle('session:showIndicator', (_e, info: unknown) => {
    const i = z
      .object({ controllerName: z.string().max(128), unattended: z.boolean() })
      .parse(info) as IndicatorInfo;
    showIndicator(i.controllerName, i.unattended, stealthEnabled);
    ctx.setSessionActive(true, i.controllerName);
  });
  ipcMain.handle('session:hideIndicator', () => {
    hideIndicator();
    input.revoke();
    ctx.setSessionActive(false, null);
  });
  ipcMain.handle('session:recordAudit', (_e, entry: unknown) => {
    store.appendAudit(entry as AuditEntry);
  });

  // ---- settings ----
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:update', (_e, patch: unknown) => {
    const clean = settingsPatchSchema.parse(patch);
    return store.updateSettings(clean);
  });
  ipcMain.handle('settings:listPaired', () => store.listPaired());
  ipcMain.handle('settings:upsertPaired', (_e, device: unknown) => {
    store.upsertPaired(pairedDeviceSchema.parse(device) as PairedDevice);
  });
  ipcMain.handle('settings:setUnattended', (_e, deviceId: unknown, enabled: unknown) => {
    store.setUnattended(z.string().parse(deviceId), z.boolean().parse(enabled));
  });
  ipcMain.handle('settings:revokeDevice', (_e, deviceId: unknown) => {
    const id = z.string().parse(deviceId);
    // Tell the signaling server to drop trust + unattended, then remove locally.
    signaling.send({ type: 'device.revoke', targetDeviceId: id });
    store.removePaired(id);
  });
  ipcMain.handle('settings:revokeAll', () => {
    const ids = store.clearPaired();
    for (const id of ids) signaling.send({ type: 'device.revoke', targetDeviceId: id });
    return ids;
  });
  ipcMain.handle('settings:setAutostart', (_e, enabled: unknown) => {
    const on = z.boolean().parse(enabled);
    app.setLoginItemSettings({ openAtLogin: on });
    store.updateSettings({ startOnLogin: on });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('settings:history', () => store.getAudit());
  ipcMain.handle('settings:clearHistory', () => store.clearAudit());

  // ---- updates ----
  ipcMain.handle('updates:check', () => ({ current: app.getVersion() }));
}
