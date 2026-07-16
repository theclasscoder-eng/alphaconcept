/**
 * Preload bridge. Exposes a single, narrowly-scoped, typed API on
 * `window.remoteDesktop`. The renderer gets NO direct access to ipcRenderer,
 * Node, fs, shell, or child_process — only these specific, validated channels.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { ServerMessage } from '@rdp/protocol';
import type {
  ActiveDisplay,
  AppSettings,
  AuditEntry,
  IndicatorInfo,
  MonitorInfo,
  OutgoingSignal,
  PairedDevice,
  PublicIdentity,
  RemoteDesktopApi,
  SignalingState,
} from '../shared-app/types.js';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: RemoteDesktopApi = {
  device: {
    getIdentity: () => ipcRenderer.invoke('device:getIdentity') as Promise<PublicIdentity>,
    setName: (name) => ipcRenderer.invoke('device:setName', name) as Promise<PublicIdentity>,
  },
  signaling: {
    getState: () => ipcRenderer.invoke('signaling:getState') as Promise<SignalingState>,
    connect: () => ipcRenderer.invoke('signaling:connect') as Promise<void>,
    disconnect: () => ipcRenderer.invoke('signaling:disconnect') as Promise<void>,
    send: (message: OutgoingSignal) =>
      ipcRenderer.invoke('signaling:send', message) as Promise<void>,
    requestSession: (hostDeviceId: string) =>
      ipcRenderer.invoke('signaling:requestSession', hostDeviceId) as Promise<string>,
    onMessage: (cb: (msg: ServerMessage) => void) => subscribe('signaling:message', cb),
    onState: (cb: (state: SignalingState) => void) => subscribe('signaling:state', cb),
  },
  capture: {
    listMonitors: () => ipcRenderer.invoke('capture:listMonitors') as Promise<MonitorInfo[]>,
  },
  session: {
    setActiveDisplay: (display: ActiveDisplay) =>
      ipcRenderer.invoke('session:setActiveDisplay', display) as Promise<void>,
    injectControl: (raw: unknown) =>
      ipcRenderer.invoke('session:injectControl', raw) as Promise<boolean>,
    setStealth: (enabled: boolean) =>
      ipcRenderer.invoke('session:setStealth', enabled) as Promise<void>,
    showIndicator: (info: IndicatorInfo) =>
      ipcRenderer.invoke('session:showIndicator', info) as Promise<void>,
    hideIndicator: () => ipcRenderer.invoke('session:hideIndicator') as Promise<void>,
    recordAudit: (entry: AuditEntry) =>
      ipcRenderer.invoke('session:recordAudit', entry) as Promise<void>,
    emergencyShortcut: () => ipcRenderer.invoke('session:emergencyShortcut') as Promise<string>,
    requiresCode: (deviceId: string) =>
      ipcRenderer.invoke('session:requiresCode', deviceId) as Promise<boolean>,
    verifyCode: (deviceId: string, sessionId: string, proof: string) =>
      ipcRenderer.invoke('session:verifyCode', deviceId, sessionId, proof) as Promise<boolean>,
    onEmergencyStop: (cb: () => void) => subscribe('session:emergency-stop', () => cb()),
    onMonitorSelect: (cb: (index: number) => void) => subscribe('session:monitor-select', cb),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
    update: (patch: Partial<AppSettings>) =>
      ipcRenderer.invoke('settings:update', patch) as Promise<AppSettings>,
    listPaired: () => ipcRenderer.invoke('settings:listPaired') as Promise<PairedDevice[]>,
    upsertPaired: (device: PairedDevice) =>
      ipcRenderer.invoke('settings:upsertPaired', device) as Promise<void>,
    setUnattended: (deviceId: string, enabled: boolean) =>
      ipcRenderer.invoke('settings:setUnattended', deviceId, enabled) as Promise<void>,
    setConnectionCode: (deviceId: string, code: string | null) =>
      ipcRenderer.invoke('settings:setConnectionCode', deviceId, code) as Promise<void>,
    codeDeviceIds: () => ipcRenderer.invoke('settings:codeDeviceIds') as Promise<string[]>,
    revokeDevice: (deviceId: string) =>
      ipcRenderer.invoke('settings:revokeDevice', deviceId) as Promise<void>,
    revokeAll: () => ipcRenderer.invoke('settings:revokeAll') as Promise<string[]>,
    setAutostart: (enabled: boolean) =>
      ipcRenderer.invoke('settings:setAutostart', enabled) as Promise<boolean>,
    history: () => ipcRenderer.invoke('settings:history') as Promise<AuditEntry[]>,
    clearHistory: () => ipcRenderer.invoke('settings:clearHistory') as Promise<void>,
  },
  updates: {
    check: () => ipcRenderer.invoke('updates:check') as Promise<{ current: string }>,
  },
  system: {
    isElevated: () => ipcRenderer.invoke('system:isElevated') as Promise<boolean>,
    relaunchElevated: () =>
      ipcRenderer.invoke('system:relaunchElevated') as Promise<
        'relaunching' | 'already-elevated' | 'cancelled' | 'unsupported'
      >,
  },
};

contextBridge.exposeInMainWorld('remoteDesktop', api);

// Minimal, separate bridge used only by the indicator overlay window.
contextBridge.exposeInMainWorld('rdIndicator', {
  onUpdate: (cb: (info: { controllerName: string; unattended: boolean }) => void) =>
    subscribe('indicator:update', cb),
});
