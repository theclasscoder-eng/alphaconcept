/**
 * Types shared across the main, preload, and renderer processes. This module is
 * TYPE-ONLY (no runtime Node/DOM imports) so it can be compiled into both the
 * node and web TypeScript projects.
 */
import type { ServerMessage, ClientMessage, QualityLevel, FrameRate } from '@rdp/protocol';

/** Public (shareable) part of this device's identity. */
export interface PublicIdentity {
  deviceId: string;
  publicKey: string;
  name: string;
  fingerprint: string;
}

export interface MonitorInfo {
  /** Electron display id, as a string. */
  id: string;
  /** desktopCapturer source id (chromeMediaSourceId). */
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  primary: boolean;
}

export interface PairedDevice {
  deviceId: string;
  name: string;
  fingerprint: string;
  /** Host-local policy: is this device allowed unattended access to us? */
  unattended: boolean;
  addedAt: number;
  online?: boolean;
  available?: boolean;
}

export interface AuditEntry {
  id: string;
  startedAt: number;
  endedAt: number | null;
  peerName: string;
  peerDeviceId: string;
  role: 'host' | 'controller';
  result: 'connected' | 'rejected' | 'failed' | 'ended';
  unattendedUsed: boolean;
  endedBy: 'host' | 'controller' | 'server' | null;
}

export interface AppSettings {
  deviceName: string;
  signalingUrl: string;
  stunUrl: string;
  turnUrl: string;
  allowIncoming: boolean;
  startOnLogin: boolean;
  clipboardSync: boolean;
  quality: QualityLevel;
  frameRate: FrameRate;
  /**
   * Hide the large on-screen "Remote session active" overlay while hosting. The
   * tray icon (which turns red during a session) remains as the persistent
   * indicator. Opt-in, behind a warning.
   */
  hideOverlay: boolean;
  /** Suppress the "run as administrator" prompt for controlling elevated apps. */
  hideAdminWarning: boolean;
  /** Host-local allow-list of controller device ids permitted unattended access. */
  unattendedDeviceIds: string[];
}

export type SignalingConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error';

export interface SignalingState {
  status: SignalingConnectionState;
  deviceId: string | null;
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  lastError: string | null;
}

/** Info the host passes to main so it can map normalized coords to the display. */
export interface ActiveDisplay {
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export interface IndicatorInfo {
  controllerName: string;
  unattended: boolean;
}

/** Distributive Omit so each union member keeps its own payload keys. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Messages the renderer asks main to send over the signaling socket. */
export type OutgoingSignal = DistributiveOmit<ClientMessage, 'v' | 'id' | 'ts' | 'from'>;

/**
 * The typed, narrowly-scoped API exposed on `window.remoteDesktop` via the
 * preload context bridge. NO raw Node, IPC, fs, or child_process is exposed.
 */
export interface RemoteDesktopApi {
  device: {
    getIdentity(): Promise<PublicIdentity>;
    setName(name: string): Promise<PublicIdentity>;
  };
  signaling: {
    getState(): Promise<SignalingState>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    send(message: OutgoingSignal): Promise<void>;
    /** Create + sign + send a session request to a host; returns the sessionId. */
    requestSession(hostDeviceId: string): Promise<string>;
    onMessage(cb: (msg: ServerMessage) => void): () => void;
    onState(cb: (state: SignalingState) => void): () => void;
  };
  capture: {
    listMonitors(): Promise<MonitorInfo[]>;
  };
  session: {
    setActiveDisplay(display: ActiveDisplay): Promise<void>;
    injectControl(raw: unknown): Promise<boolean>;
    setStealth(enabled: boolean): Promise<void>;
    showIndicator(info: IndicatorInfo): Promise<void>;
    hideIndicator(): Promise<void>;
    recordAudit(entry: AuditEntry): Promise<void>;
    /** The registered host emergency-stop accelerator, e.g. "Ctrl+Alt+F12". */
    emergencyShortcut(): Promise<string>;
    onEmergencyStop(cb: () => void): () => void;
    onMonitorSelect(cb: (index: number) => void): () => void;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    listPaired(): Promise<PairedDevice[]>;
    upsertPaired(device: PairedDevice): Promise<void>;
    setUnattended(deviceId: string, enabled: boolean): Promise<void>;
    revokeDevice(deviceId: string): Promise<void>;
    revokeAll(): Promise<string[]>;
    setAutostart(enabled: boolean): Promise<boolean>;
    history(): Promise<AuditEntry[]>;
    clearHistory(): Promise<void>;
  };
  updates: {
    check(): Promise<{ current: string }>;
  };
  system: {
    /** True if the host app runs elevated (can control admin windows). */
    isElevated(): Promise<boolean>;
    /** Relaunch the app as administrator (UAC prompt). */
    relaunchElevated(): Promise<'relaunching' | 'already-elevated' | 'cancelled' | 'unsupported'>;
  };
}
