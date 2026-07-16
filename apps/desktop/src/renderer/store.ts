/**
 * Central renderer state (Zustand) and the session state machine. Subscribes to
 * signaling messages from the main process and drives the WebRTC host/controller
 * sessions. Long-lived WebRTC objects are kept in module refs (not React state)
 * to avoid re-render churn.
 */
import { create } from 'zustand';
import type { ServerMessage, PeerInfo } from '@rdp/protocol';
import { rd } from './api.js';
import { ControllerSession } from './session/controller.js';
import { HostSession } from './session/host.js';
import type { ConnectionQuality } from './session/stats.js';
import type {
  AppSettings,
  AuditEntry,
  MonitorInfo,
  PairedDevice,
  PublicIdentity,
  SignalingState,
} from '../shared-app/types.js';

type SessionPhase = 'idle' | 'requesting' | 'incoming' | 'connecting' | 'active' | 'ended';

interface PairingUiState {
  mode: 'none' | 'created' | 'joining' | 'approving';
  code?: string;
  pairingId?: string;
  expiresAt?: number;
  peer?: PeerInfo;
}

interface SessionUiState {
  phase: SessionPhase;
  role: 'host' | 'controller' | null;
  sessionId: string | null;
  peer: PeerInfo | null;
  unattended: boolean;
  quality: ConnectionQuality | null;
  error: string | null;
}

interface State {
  identity: PublicIdentity | null;
  signaling: SignalingState;
  settings: AppSettings | null;
  paired: PairedDevice[];
  presence: Record<string, { online: boolean; available: boolean }>;
  monitors: MonitorInfo[];
  selectedMonitorId: string | null;
  pairing: PairingUiState;
  session: SessionUiState;
  remoteStream: MediaStream | null;
  banner: string | null;
  history: AuditEntry[];

  init(): Promise<void>;
  refreshPaired(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  setName(name: string): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;

  startPairingAsHost(): Promise<void>;
  joinPairing(code: string): Promise<void>;
  approvePairing(unattended: boolean): Promise<void>;
  rejectPairing(): Promise<void>;
  cancelPairing(): void;

  requestSession(hostDeviceId: string): Promise<void>;
  approveIncoming(): Promise<void>;
  rejectIncoming(reason?: string): Promise<void>;
  endSession(reason?: string): Promise<void>;

  setUnattended(deviceId: string, enabled: boolean): Promise<void>;
  revokeDevice(deviceId: string): Promise<void>;
  revokeAll(): Promise<void>;
  refreshMonitors(): Promise<void>;
  selectMonitor(id: string): void;
  loadHistory(): Promise<void>;
  clearHistory(): Promise<void>;
  dismissBanner(): void;
}

// Module-level WebRTC refs (not part of React state).
let controllerSession: ControllerSession | null = null;
let hostSession: HostSession | null = null;
let currentAudit: AuditEntry | null = null;
let pendingApproval: { pairingId: string; unattended: boolean; peer?: PeerInfo } | null = null;

function uid(): string {
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useStore = create<State>((set, get) => {
  const send = (m: Parameters<typeof rd.signaling.send>[0]) => rd.signaling.send(m);

  function teardownSession(result: AuditEntry['result'], endedBy: AuditEntry['endedBy']): void {
    controllerSession?.stop();
    hostSession?.stop();
    const wasHost = get().session.role === 'host';
    controllerSession = null;
    hostSession = null;
    if (wasHost) void rd.session.hideIndicator();
    if (currentAudit) {
      const entry: AuditEntry = {
        ...currentAudit,
        endedAt: Date.now(),
        result,
        endedBy,
      };
      void rd.session.recordAudit(entry);
      currentAudit = null;
    }
    set({
      remoteStream: null,
      session: {
        ...get().session,
        phase: 'ended',
        quality: null,
      },
    });
  }

  async function handleMessage(msg: ServerMessage): Promise<void> {
    switch (msg.type) {
      case 'device.presence': {
        set((s) => ({
          presence: {
            ...s.presence,
            [msg.deviceId]: { online: msg.online, available: msg.available },
          },
        }));
        break;
      }
      case 'pairing.created':
        set({
          pairing: {
            mode: 'created',
            code: msg.code,
            pairingId: msg.pairingId,
            expiresAt: msg.expiresAt,
          },
        });
        break;
      case 'pairing.pending':
        pendingApproval = { pairingId: msg.pairingId, unattended: false, peer: msg.peer };
        set({ pairing: { mode: 'approving', pairingId: msg.pairingId, peer: msg.peer } });
        break;
      case 'pairing.result': {
        if (msg.status === 'approved' && msg.peer) {
          const isApprover = pendingApproval?.pairingId === msg.pairingId;
          const device: PairedDevice = {
            deviceId: msg.peer.deviceId,
            name: msg.peer.name,
            fingerprint: msg.peer.fingerprint,
            unattended: isApprover ? (pendingApproval?.unattended ?? false) : false,
            addedAt: Date.now(),
          };
          await rd.settings.upsertPaired(device);
          if (isApprover && pendingApproval?.unattended) {
            await rd.settings.setUnattended(msg.peer.deviceId, true);
          }
          await get().refreshPaired();
          set({ banner: `Paired with ${msg.peer.name}`, pairing: { mode: 'none' } });
        } else {
          set({
            pairing: { mode: 'none' },
            banner: msg.status === 'rejected' ? 'Pairing was rejected' : 'Pairing expired',
          });
        }
        pendingApproval = null;
        break;
      }
      case 'session.incoming': {
        const settings = get().settings;
        const allow = settings?.allowIncoming ?? false;
        const unattendedOk =
          allow && (settings?.unattendedDeviceIds.includes(msg.from.deviceId) ?? false);
        set({
          session: {
            phase: 'incoming',
            role: 'host',
            sessionId: msg.sessionId,
            peer: msg.from,
            unattended: msg.unattended,
            quality: null,
            error: null,
          },
        });
        if (!allow) {
          await get().rejectIncoming('incoming disabled');
        } else if (unattendedOk) {
          await get().approveIncoming();
        }
        break;
      }
      case 'session.approved': {
        const role = get().session.role;
        currentAudit = {
          id: uid(),
          startedAt: Date.now(),
          endedAt: null,
          peerName: msg.peer.name,
          peerDeviceId: msg.peer.deviceId,
          role: role ?? 'controller',
          result: 'connected',
          unattendedUsed: get().session.unattended,
          endedBy: null,
        };
        void rd.session.recordAudit(currentAudit);
        if (role === 'controller') {
          controllerSession = new ControllerSession(msg.sessionId, msg.iceServers, send, {
            onStream: (stream) => set({ remoteStream: stream }),
            onQuality: (q) => set((s) => ({ session: { ...s.session, quality: q } })),
            onClosed: () => teardownSession('failed', 'server'),
            onChannelOpen: () =>
              set((s) => ({ session: { ...s.session, phase: 'active' } })),
          });
          set((s) => ({ session: { ...s.session, phase: 'connecting' } }));
          await controllerSession.start();
        } else if (role === 'host') {
          const monitor =
            get().monitors.find((m) => m.id === get().selectedMonitorId) ?? get().monitors[0];
          if (!monitor) {
            set({ banner: 'No monitor available to share' });
            await get().endSession('no monitor');
            return;
          }
          const settings = get().settings;
          hostSession = new HostSession(
            msg.sessionId,
            msg.iceServers,
            monitor,
            send,
            {
              onControl: (raw) => void rd.session.injectControl(raw),
              onQuality: (q) => set((s) => ({ session: { ...s.session, quality: q } })),
              onClosed: () => teardownSession('ended', 'server'),
              onCaptureError: (m) => {
                // Don't leave the controller staring at a black screen: surface
                // the error here and end the session so it gets a clear signal.
                set({ banner: `Capture error: ${m}` });
                void get().endSession('host capture failed');
              },
            },
            settings?.quality ?? 'balanced',
            settings?.frameRate ?? 30,
          );
          await rd.session.setActiveDisplay({
            bounds: monitor.bounds,
            scaleFactor: monitor.scaleFactor,
          });
          await rd.session.showIndicator({
            controllerName: msg.peer.name,
            unattended: get().session.unattended,
          });
          set((s) => ({ session: { ...s.session, phase: 'connecting' } }));
          await hostSession.start();
        }
        break;
      }
      case 'webrtc.offer':
        if (hostSession) await hostSession.onOffer(msg.sdp.sdp);
        break;
      case 'webrtc.answer':
        if (controllerSession) await controllerSession.onAnswer(msg.sdp.sdp);
        break;
      case 'webrtc.ice-candidate':
        if (hostSession) await hostSession.onRemoteIce(msg.candidate as RTCIceCandidateInit);
        if (controllerSession)
          await controllerSession.onRemoteIce(msg.candidate as RTCIceCandidateInit);
        break;
      case 'session.rejected':
        set((s) => ({
          session: { ...s.session, phase: 'ended', error: msg.reason ?? 'rejected' },
          banner: `Session rejected${msg.reason ? `: ${msg.reason}` : ''}`,
        }));
        teardownSession('rejected', 'host');
        break;
      case 'session.ended':
        set({ banner: `Session ended by ${msg.by}` });
        teardownSession('ended', msg.by);
        break;
      case 'device.revoked':
        set({ banner: 'A device revoked access' });
        await rd.settings.revokeDevice(msg.peerDeviceId).catch(() => undefined);
        await get().refreshPaired();
        break;
      case 'error':
        set({ banner: `Error: ${msg.message}` });
        break;
      default:
        break;
    }
  }

  return {
    identity: null,
    signaling: { status: 'disconnected', deviceId: null, iceServers: [], lastError: null },
    settings: null,
    paired: [],
    presence: {},
    monitors: [],
    selectedMonitorId: null,
    pairing: { mode: 'none' },
    session: {
      phase: 'idle',
      role: null,
      sessionId: null,
      peer: null,
      unattended: false,
      quality: null,
      error: null,
    },
    remoteStream: null,
    banner: null,
    history: [],

    async init() {
      const [identity, settings, paired] = await Promise.all([
        rd.device.getIdentity(),
        rd.settings.get(),
        rd.settings.listPaired(),
      ]);
      set({ identity, settings, paired, signaling: await rd.signaling.getState() });

      rd.signaling.onState((state) => set({ signaling: state }));
      rd.signaling.onMessage((msg) => void handleMessage(msg));
      rd.session.onEmergencyStop(() => void get().endSession('emergency stop'));
      rd.session.onMonitorSelect((index) => {
        const mon = get().monitors[index];
        if (mon && hostSession) void hostSession.switchMonitor(mon);
      });

      await get().refreshMonitors();
      await rd.signaling.connect();
    },

    async refreshPaired() {
      set({ paired: await rd.settings.listPaired() });
    },

    async connect() {
      await rd.signaling.connect();
    },
    async disconnect() {
      await rd.signaling.disconnect();
    },
    async setName(name) {
      const identity = await rd.device.setName(name);
      set({ identity });
      set({ settings: await rd.settings.get() });
    },
    async updateSettings(patch) {
      const settings = await rd.settings.update(patch);
      set({ settings });
    },

    async startPairingAsHost() {
      set({ pairing: { mode: 'created' } });
      send({ type: 'pairing.create' });
    },
    async joinPairing(code) {
      set({ pairing: { mode: 'joining' } });
      send({ type: 'pairing.join', code: code.toUpperCase().trim() });
    },
    async approvePairing(unattended) {
      const p = get().pairing;
      if (!p.pairingId) return;
      if (pendingApproval) pendingApproval.unattended = unattended;
      send({ type: 'pairing.approve', pairingId: p.pairingId, unattended });
    },
    async rejectPairing() {
      const p = get().pairing;
      if (p.pairingId) send({ type: 'pairing.reject', pairingId: p.pairingId });
      pendingApproval = null;
      set({ pairing: { mode: 'none' } });
    },
    cancelPairing() {
      pendingApproval = null;
      set({ pairing: { mode: 'none' } });
    },

    async requestSession(hostDeviceId) {
      const peer = get().paired.find((p) => p.deviceId === hostDeviceId);
      set({
        session: {
          phase: 'requesting',
          role: 'controller',
          sessionId: null,
          peer: peer
            ? { deviceId: peer.deviceId, name: peer.name, fingerprint: peer.fingerprint }
            : null,
          unattended: false,
          quality: null,
          error: null,
        },
      });
      const sessionId = await rd.signaling.requestSession(hostDeviceId);
      set((s) => ({ session: { ...s.session, sessionId } }));
    },
    async approveIncoming() {
      const sid = get().session.sessionId;
      if (sid) send({ type: 'session.approve', sessionId: sid });
    },
    async rejectIncoming(reason) {
      const sid = get().session.sessionId;
      if (sid) send({ type: 'session.reject', sessionId: sid, reason });
      set((s) => ({ session: { ...s.session, phase: 'idle', role: null } }));
    },
    async endSession(reason) {
      const sid = get().session.sessionId;
      if (sid) send({ type: 'session.end', sessionId: sid, reason });
      teardownSession('ended', get().session.role === 'host' ? 'host' : 'controller');
      set((s) => ({ session: { ...s.session, phase: 'idle', role: null, sessionId: null } }));
    },

    async setUnattended(deviceId, enabled) {
      await rd.settings.setUnattended(deviceId, enabled);
      await get().refreshPaired();
      set({ settings: await rd.settings.get() });
    },
    async revokeDevice(deviceId) {
      await rd.settings.revokeDevice(deviceId);
      await get().refreshPaired();
    },
    async revokeAll() {
      await rd.settings.revokeAll();
      await get().refreshPaired();
    },
    async refreshMonitors() {
      const monitors = await rd.capture.listMonitors();
      const selected =
        get().selectedMonitorId ?? monitors.find((m) => m.primary)?.id ?? monitors[0]?.id ?? null;
      set({ monitors, selectedMonitorId: selected });
    },
    selectMonitor(id) {
      set({ selectedMonitorId: id });
      const mon = get().monitors.find((m) => m.id === id);
      if (mon && hostSession) void hostSession.switchMonitor(mon);
    },
    async loadHistory() {
      set({ history: await rd.settings.history() });
    },
    async clearHistory() {
      await rd.settings.clearHistory();
      set({ history: [] });
    },
    dismissBanner() {
      set({ banner: null });
    },
  };
});

/** Access the live controller session (for the viewer to send input). */
export function getControllerSession(): ControllerSession | null {
  return controllerSession;
}
