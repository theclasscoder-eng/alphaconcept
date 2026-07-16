/**
 * Core signaling logic, decoupled from the WebSocket transport so it can be
 * unit/integration tested directly. The hub:
 *   - challenges every connection and authenticates it via device signature,
 *   - relays ONLY session-establishment metadata (never media/input),
 *   - enforces trust, unattended-access rules, rate limits, replay protection,
 *     and message validation at the boundary.
 */
import {
  PROTOCOL_VERSION,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  SESSION_REQUEST_TTL_MS,
  CHALLENGE_TTL_MS,
  MAX_MESSAGE_CLOCK_SKEW_MS,
  createAuthChallenge,
  verifyAuthChallenge,
  verifySignature,
  fingerprint,
  deviceIdFromPublicKey,
  generatePairingCode,
  randomId,
  KeyedRateLimiter,
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
  type PeerInfo,
  type AuthChallenge,
} from '@rdp/protocol';
import type { Repository } from './repository/index.js';
import { TokenService, NonceStore, issueIceServers } from './auth.js';
import type { Env } from './env.js';
import type { Logger } from './logger.js';

export interface Connection {
  readonly id: string;
  readonly remoteIp: string;
  readonly origin: string | undefined;
  deviceId: string | null;
  authenticated: boolean;
  available: boolean;
  challenge: AuthChallenge | null;
  seenMessageIds: Set<string>;
  send(msg: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

interface HubDeps {
  repo: Repository;
  env: Env;
  logger: Logger;
  tokens: TokenService;
  nonces: NonceStore;
}

export class SignalingHub {
  private readonly connections = new Map<string, Connection>();
  private readonly deviceConnections = new Map<string, Set<string>>();
  /** sessionId -> the two participating device ids. */
  private readonly activeSessions = new Map<
    string,
    { hostDeviceId: string; controllerDeviceId: string }
  >();

  private readonly msgLimiter = new KeyedRateLimiter({ capacity: 120, refillPerSecond: 60 });
  private readonly pairingCreateLimiter = new KeyedRateLimiter({
    capacity: 5,
    refillPerSecond: 5 / 300,
  });
  private readonly pairingJoinLimiter = new KeyedRateLimiter({
    capacity: 10,
    refillPerSecond: 10 / 60,
  });
  private readonly sessionLimiter = new KeyedRateLimiter({ capacity: 20, refillPerSecond: 20 / 60 });

  constructor(private readonly deps: HubDeps) {}

  // ---- lifecycle ----------------------------------------------------------

  onConnect(conn: Connection): void {
    this.connections.set(conn.id, conn);
    const challenge = createAuthChallenge(this.deps.env.DEVICE_CHALLENGE_SECRET, CHALLENGE_TTL_MS);
    conn.challenge = challenge;
    conn.send(this.envelope('device.challenge', challenge));
  }

  onClose(conn: Connection): void {
    this.connections.delete(conn.id);
    if (conn.deviceId) {
      const set = this.deviceConnections.get(conn.deviceId);
      set?.delete(conn.id);
      if (set && set.size === 0) {
        this.deviceConnections.delete(conn.deviceId);
        // Device fully offline: end its sessions and notify peers.
        void this.handleDeviceOffline(conn.deviceId);
      }
    }
  }

  async onMessage(conn: Connection, raw: unknown): Promise<void> {
    if (!this.msgLimiter.tryConsume(conn.id)) {
      conn.send(this.error('rate-limited', 'Too many messages.'));
      return;
    }
    const parsed = parseClientMessage(raw);
    if (!parsed.success) {
      conn.send(this.error('bad-message', 'Message failed validation.'));
      return;
    }
    const msg = parsed.data;

    // Clock-skew / replay guards for all but the very first authenticate.
    if (Math.abs(Date.now() - msg.ts) > MAX_MESSAGE_CLOCK_SKEW_MS) {
      conn.send(this.error('clock-skew', 'Message timestamp outside allowed window.'));
      return;
    }
    if (conn.seenMessageIds.has(msg.id)) {
      conn.send(this.error('replay', 'Duplicate message id.'));
      return;
    }
    conn.seenMessageIds.add(msg.id);
    if (conn.seenMessageIds.size > 1000) {
      // Bound memory: drop oldest half.
      conn.seenMessageIds = new Set([...conn.seenMessageIds].slice(-500));
    }

    if (msg.type === 'device.authenticate') {
      await this.handleAuthenticate(conn, msg);
      return;
    }

    if (!conn.authenticated || !conn.deviceId) {
      conn.send(this.error('unauthenticated', 'Authenticate before sending this message.'));
      return;
    }
    // The `from` field must match the authenticated device identity.
    if (msg.from !== conn.deviceId) {
      conn.send(this.error('identity-mismatch', 'Sender id does not match session identity.'));
      return;
    }

    try {
      await this.route(conn, msg);
    } catch (err) {
      this.deps.logger.error({ err: String(err), type: msg.type }, 'handler error');
      conn.send(this.error('internal', 'Failed to process message.'));
    }
  }

  private async route(conn: Connection, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'device.presence.set':
        return this.handlePresenceSet(conn, msg.available);
      case 'pairing.create':
        return this.handlePairingCreate(conn);
      case 'pairing.join':
        return this.handlePairingJoin(conn, msg.code);
      case 'pairing.approve':
        return this.handlePairingApprove(conn, msg.pairingId, msg.unattended);
      case 'pairing.reject':
        return this.handlePairingReject(conn, msg.pairingId);
      case 'session.request':
        return this.handleSessionRequest(conn, msg.toDeviceId, msg.sessionId, msg.signature);
      case 'session.approve':
        return this.handleSessionApprove(conn, msg.sessionId);
      case 'session.reject':
        return this.handleSessionReject(conn, msg.sessionId, msg.reason);
      case 'webrtc.offer':
      case 'webrtc.answer':
      case 'webrtc.ice-candidate':
      case 'session.heartbeat':
        return this.relayWithinSession(conn, msg);
      case 'session.end':
        return this.handleSessionEnd(conn, msg.sessionId, msg.reason);
      case 'device.revoke':
        return this.handleRevoke(conn, msg.targetDeviceId);
      default:
        conn.send(this.error('unsupported', 'Unsupported message type.'));
    }
  }

  // ---- authentication -----------------------------------------------------

  private async handleAuthenticate(
    conn: Connection,
    msg: Extract<ClientMessage, { type: 'device.authenticate' }>,
  ): Promise<void> {
    const challenge: AuthChallenge = {
      challengeId: msg.challengeId,
      nonce: msg.nonce,
      expiresAt: msg.expiresAt,
      mac: msg.mac,
    };
    if (!verifyAuthChallenge(this.deps.env.DEVICE_CHALLENGE_SECRET, challenge)) {
      conn.send(this.error('bad-challenge', 'Challenge invalid or expired.'));
      return;
    }
    if (!this.deps.nonces.consume(msg.nonce)) {
      conn.send(this.error('replay', 'Challenge nonce already used.'));
      return;
    }
    const derivedId = deviceIdFromPublicKey(msg.publicKey);
    if (derivedId !== msg.from) {
      conn.send(this.error('identity-mismatch', 'Device id does not match public key.'));
      return;
    }
    if (!verifySignature(msg.publicKey, msg.nonce, msg.signature)) {
      conn.send(this.error('bad-signature', 'Signature verification failed.'));
      return;
    }

    const device = await this.deps.repo.upsertDevice(msg.publicKey, msg.name);
    conn.deviceId = device.id;
    conn.authenticated = true;
    let set = this.deviceConnections.get(device.id);
    if (!set) {
      set = new Set();
      this.deviceConnections.set(device.id, set);
    }
    set.add(conn.id);

    const { token, expiresAt } = await this.deps.tokens.issue(device.id);
    conn.send(
      this.envelope('device.authenticated', {
        deviceId: device.id,
        token,
        tokenExpiresAt: expiresAt,
        iceServers: issueIceServers(this.deps.env),
      }),
    );
    this.deps.logger.info({ deviceId: device.id }, 'device authenticated');

    // Tell this device the presence of its trusted peers, and peers about it.
    await this.broadcastPresence(device.id);
    await this.sendPeerPresenceSnapshot(conn, device.id);
  }

  // ---- presence -----------------------------------------------------------

  private async handlePresenceSet(conn: Connection, available: boolean): Promise<void> {
    conn.available = available;
    if (conn.deviceId) await this.broadcastPresence(conn.deviceId);
  }

  private isOnline(deviceId: string): boolean {
    return (this.deviceConnections.get(deviceId)?.size ?? 0) > 0;
  }

  private isAvailable(deviceId: string): boolean {
    for (const cid of this.deviceConnections.get(deviceId) ?? []) {
      if (this.connections.get(cid)?.available) return true;
    }
    return false;
  }

  private async broadcastPresence(deviceId: string): Promise<void> {
    const peers = await this.deps.repo.listTrustedPeers(deviceId);
    const online = this.isOnline(deviceId);
    const available = this.isAvailable(deviceId);
    for (const peerId of peers) {
      this.sendToDevice(
        peerId,
        this.envelope('device.presence', { deviceId, online, available }),
      );
    }
  }

  private async sendPeerPresenceSnapshot(conn: Connection, deviceId: string): Promise<void> {
    const peers = await this.deps.repo.listTrustedPeers(deviceId);
    for (const peerId of peers) {
      conn.send(
        this.envelope('device.presence', {
          deviceId: peerId,
          online: this.isOnline(peerId),
          available: this.isAvailable(peerId),
        }),
      );
    }
  }

  // ---- pairing ------------------------------------------------------------

  private async handlePairingCreate(conn: Connection): Promise<void> {
    const deviceId = conn.deviceId!;
    if (!this.pairingCreateLimiter.tryConsume(deviceId)) {
      conn.send(this.error('rate-limited', 'Too many pairing requests.'));
      return;
    }
    const now = Date.now();
    const record = await this.deps.repo.createPairing({
      id: randomId(),
      code: generatePairingCode(PAIRING_CODE_LENGTH),
      creatorDeviceId: deviceId,
      joinerDeviceId: null,
      status: 'pending',
      unattended: false,
      createdAt: now,
      expiresAt: now + PAIRING_CODE_TTL_MS,
    });
    conn.send(
      this.envelope('pairing.created', {
        pairingId: record.id,
        code: record.code,
        expiresAt: record.expiresAt,
      }),
    );
  }

  private async handlePairingJoin(conn: Connection, code: string): Promise<void> {
    const deviceId = conn.deviceId!;
    if (!this.pairingJoinLimiter.tryConsume(`${deviceId}:${conn.remoteIp}`)) {
      conn.send(this.error('rate-limited', 'Too many pairing attempts.'));
      return;
    }
    const now = Date.now();
    const pairing = await this.deps.repo.getActivePairingByCode(code, now);
    if (!pairing) {
      conn.send(this.error('pairing-invalid', 'Pairing code is invalid or expired.'));
      return;
    }
    if (pairing.creatorDeviceId === deviceId) {
      conn.send(this.error('pairing-self', 'Cannot pair a device with itself.'));
      return;
    }
    await this.deps.repo.updatePairing(pairing.id, { joinerDeviceId: deviceId, status: 'joined' });
    const joiner = await this.peerInfo(deviceId);
    if (!joiner) return;
    // Notify the creator so they can approve/reject.
    this.sendToDevice(
      pairing.creatorDeviceId,
      this.envelope('pairing.pending', { pairingId: pairing.id, peer: joiner }),
    );
  }

  private async handlePairingApprove(
    conn: Connection,
    pairingId: string,
    unattended: boolean,
  ): Promise<void> {
    const deviceId = conn.deviceId!;
    const pairing = await this.deps.repo.getPairingById(pairingId);
    if (!pairing || pairing.creatorDeviceId !== deviceId) {
      conn.send(this.error('pairing-invalid', 'Unknown pairing.'));
      return;
    }
    if (pairing.status !== 'joined' || !pairing.joinerDeviceId || pairing.expiresAt <= Date.now()) {
      conn.send(this.error('pairing-invalid', 'Pairing not ready to approve.'));
      return;
    }
    const joinerId = pairing.joinerDeviceId;
    await this.deps.repo.createTrust(deviceId, joinerId);
    if (unattended) {
      // The approver (creator) is the host granting the joiner unattended access.
      await this.deps.repo.grantUnattended(deviceId, joinerId);
    }
    await this.deps.repo.updatePairing(pairingId, { status: 'approved', unattended });

    const creatorInfo = await this.peerInfo(deviceId);
    const joinerInfo = await this.peerInfo(joinerId);
    // Result to joiner (their new trusted peer is the creator).
    this.sendToDevice(
      joinerId,
      this.envelope('pairing.result', {
        pairingId,
        status: 'approved',
        peer: creatorInfo ?? undefined,
        unattended,
      }),
    );
    // Result to creator (their new trusted peer is the joiner).
    this.sendToDevice(
      deviceId,
      this.envelope('pairing.result', {
        pairingId,
        status: 'approved',
        peer: joinerInfo ?? undefined,
        unattended,
      }),
    );
    await this.broadcastPresence(deviceId);
    await this.broadcastPresence(joinerId);
  }

  private async handlePairingReject(conn: Connection, pairingId: string): Promise<void> {
    const deviceId = conn.deviceId!;
    const pairing = await this.deps.repo.getPairingById(pairingId);
    if (!pairing || pairing.creatorDeviceId !== deviceId) {
      conn.send(this.error('pairing-invalid', 'Unknown pairing.'));
      return;
    }
    await this.deps.repo.updatePairing(pairingId, { status: 'rejected' });
    if (pairing.joinerDeviceId) {
      this.sendToDevice(
        pairing.joinerDeviceId,
        this.envelope('pairing.result', { pairingId, status: 'rejected' }),
      );
    }
  }

  // ---- sessions -----------------------------------------------------------

  private async handleSessionRequest(
    conn: Connection,
    hostDeviceId: string,
    sessionId: string,
    signature: string,
  ): Promise<void> {
    const controllerId = conn.deviceId!;
    if (!this.sessionLimiter.tryConsume(controllerId)) {
      conn.send(this.error('rate-limited', 'Too many session requests.'));
      return;
    }
    const controller = await this.deps.repo.getDevice(controllerId);
    if (!controller) {
      conn.send(this.error('unknown-device', 'Controller device not registered.'));
      return;
    }
    // Prove the request origin: signature over `${sessionId}.${hostDeviceId}`.
    if (!verifySignature(controller.publicKey, `${sessionId}.${hostDeviceId}`, signature)) {
      conn.send(this.error('bad-signature', 'Session request signature invalid.'));
      return;
    }
    if (!(await this.deps.repo.areTrusted(controllerId, hostDeviceId))) {
      conn.send(this.error('not-trusted', 'Host is not a trusted device.'));
      return;
    }
    if (!this.isOnline(hostDeviceId)) {
      conn.send(this.error('host-offline', 'Host is offline.'));
      return;
    }
    const unattended = await this.deps.repo.isUnattendedAllowed(hostDeviceId, controllerId);
    const now = Date.now();
    await this.deps.repo.createSession({
      id: sessionId,
      hostDeviceId,
      controllerDeviceId: controllerId,
      status: 'requested',
      unattended,
      endedBy: null,
      createdAt: now,
      expiresAt: now + SESSION_REQUEST_TTL_MS,
    });
    const controllerInfo = await this.peerInfo(controllerId);
    if (!controllerInfo) return;
    this.sendToDevice(
      hostDeviceId,
      this.envelope('session.incoming', { sessionId, from: controllerInfo, unattended }),
    );
  }

  private async handleSessionApprove(conn: Connection, sessionId: string): Promise<void> {
    const session = await this.deps.repo.getSession(sessionId);
    if (!session || session.hostDeviceId !== conn.deviceId) {
      conn.send(this.error('session-invalid', 'Unknown session.'));
      return;
    }
    if (session.status !== 'requested' || session.expiresAt <= Date.now()) {
      conn.send(this.error('session-invalid', 'Session no longer pending.'));
      return;
    }
    await this.deps.repo.updateSession(sessionId, { status: 'approved' });
    this.activeSessions.set(sessionId, {
      hostDeviceId: session.hostDeviceId,
      controllerDeviceId: session.controllerDeviceId,
    });
    const ice = issueIceServers(this.deps.env);
    const hostInfo = await this.peerInfo(session.hostDeviceId);
    const controllerInfo = await this.peerInfo(session.controllerDeviceId);
    // Controller connects to host: give it host peer info + ICE.
    this.sendToDevice(
      session.controllerDeviceId,
      this.envelope('session.approved', {
        sessionId,
        iceServers: ice,
        peer: hostInfo ?? emptyPeer(session.hostDeviceId),
      }),
    );
    // Host also needs ICE + controller peer info.
    this.sendToDevice(
      session.hostDeviceId,
      this.envelope('session.approved', {
        sessionId,
        iceServers: ice,
        peer: controllerInfo ?? emptyPeer(session.controllerDeviceId),
      }),
    );
  }

  private async handleSessionReject(
    conn: Connection,
    sessionId: string,
    reason?: string,
  ): Promise<void> {
    const session = await this.deps.repo.getSession(sessionId);
    if (!session || session.hostDeviceId !== conn.deviceId) {
      conn.send(this.error('session-invalid', 'Unknown session.'));
      return;
    }
    await this.deps.repo.updateSession(sessionId, { status: 'rejected' });
    this.sendToDevice(
      session.controllerDeviceId,
      this.envelope('session.rejected', { sessionId, reason }),
    );
  }

  private async relayWithinSession(conn: Connection, msg: ClientMessage): Promise<void> {
    if (
      msg.type !== 'webrtc.offer' &&
      msg.type !== 'webrtc.answer' &&
      msg.type !== 'webrtc.ice-candidate' &&
      msg.type !== 'session.heartbeat'
    ) {
      return;
    }
    const route = this.activeSessions.get(msg.sessionId);
    if (!route) {
      conn.send(this.error('session-invalid', 'No active session for relay.'));
      return;
    }
    const me = conn.deviceId!;
    if (me !== route.hostDeviceId && me !== route.controllerDeviceId) {
      conn.send(this.error('forbidden', 'Not a participant in this session.'));
      return;
    }
    const target = me === route.hostDeviceId ? route.controllerDeviceId : route.hostDeviceId;
    // Forward the already-validated message verbatim (it is also a valid
    // server message in the union). The signaling server never inspects SDP.
    this.sendToDevice(target, msg as unknown as ServerMessage);
  }

  private async handleSessionEnd(
    conn: Connection,
    sessionId: string,
    reason?: string,
  ): Promise<void> {
    const route = this.activeSessions.get(sessionId);
    const me = conn.deviceId!;
    const session = await this.deps.repo.getSession(sessionId);
    const by: 'host' | 'controller' =
      session && session.hostDeviceId === me ? 'host' : 'controller';
    await this.deps.repo.updateSession(sessionId, { status: 'ended', endedBy: by });
    if (route) {
      const target = me === route.hostDeviceId ? route.controllerDeviceId : route.hostDeviceId;
      this.sendToDevice(target, this.envelope('session.ended', { sessionId, by, reason }));
      this.activeSessions.delete(sessionId);
    }
  }

  // ---- revocation ---------------------------------------------------------

  private async handleRevoke(conn: Connection, targetDeviceId: string): Promise<void> {
    const me = conn.deviceId!;
    await this.deps.repo.removeTrust(me, targetDeviceId);
    // End any active session between the two devices.
    for (const [sid, route] of this.activeSessions) {
      const pair = [route.hostDeviceId, route.controllerDeviceId];
      if (pair.includes(me) && pair.includes(targetDeviceId)) {
        await this.deps.repo.updateSession(sid, { status: 'ended', endedBy: 'server' });
        this.sendToDevice(
          targetDeviceId,
          this.envelope('session.ended', { sessionId: sid, by: 'server', reason: 'revoked' }),
        );
        this.sendToDevice(
          me,
          this.envelope('session.ended', { sessionId: sid, by: 'server', reason: 'revoked' }),
        );
        this.activeSessions.delete(sid);
      }
    }
    this.sendToDevice(targetDeviceId, this.envelope('device.revoked', { peerDeviceId: me }));
    this.deps.logger.info({ by: me }, 'device revoked a peer');
  }

  private async handleDeviceOffline(deviceId: string): Promise<void> {
    // End sessions involving this device.
    for (const [sid, route] of this.activeSessions) {
      if (route.hostDeviceId === deviceId || route.controllerDeviceId === deviceId) {
        const other =
          route.hostDeviceId === deviceId ? route.controllerDeviceId : route.hostDeviceId;
        this.sendToDevice(
          other,
          this.envelope('session.ended', { sessionId: sid, by: 'server', reason: 'peer-offline' }),
        );
        await this.deps.repo.updateSession(sid, { status: 'ended', endedBy: 'server' });
        this.activeSessions.delete(sid);
      }
    }
    await this.broadcastPresence(deviceId);
  }

  // ---- helpers ------------------------------------------------------------

  private async peerInfo(deviceId: string): Promise<PeerInfo | null> {
    const d = await this.deps.repo.getDevice(deviceId);
    if (!d) return null;
    return { deviceId: d.id, name: d.name, fingerprint: fingerprint(d.publicKey) };
  }

  private sendToDevice(deviceId: string, msg: ServerMessage): void {
    for (const cid of this.deviceConnections.get(deviceId) ?? []) {
      this.connections.get(cid)?.send(msg);
    }
  }

  private envelope<T extends object>(type: string, payload: T): ServerMessage {
    return {
      v: PROTOCOL_VERSION,
      id: randomId(),
      ts: Date.now(),
      from: 'server',
      type,
      ...payload,
    } as unknown as ServerMessage;
  }

  private error(code: string, message: string, relatedId?: string): ServerMessage {
    return this.envelope('error', { code, message, relatedId });
  }

  /** Periodic maintenance: expire stale pairings/sessions. */
  async sweep(): Promise<void> {
    const now = Date.now();
    await this.deps.repo.expirePairings(now);
    await this.deps.repo.expireSessions(now);
  }
}

function emptyPeer(deviceId: string): PeerInfo {
  return { deviceId, name: deviceId.slice(0, 8), fingerprint: '' };
}
