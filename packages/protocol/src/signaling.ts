/**
 * Versioned signaling protocol. Every message crossing the WebSocket boundary
 * is validated against these Zod schemas on receipt (both directions). Unknown
 * keys are rejected (`.strict()`); an unrecognised protocol version fails the
 * `v` literal check.
 *
 * Message envelope (every message):
 *   v    protocol version (integer literal)
 *   id   unique message id (uuid) — used for correlation and replay tracking
 *   ts   client/server timestamp (ms since epoch)
 *   from sender device id, or the literal "server" for server-origin messages
 *   type discriminator
 *
 * The signaling server only ever sees session-ESTABLISHMENT metadata. It never
 * receives screen content, input events, or clipboard data.
 */
import { z } from 'zod';
import { PROTOCOL_VERSION } from './constants.js';

export const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;

export const sdpSchema = z.object({
  type: z.enum(['offer', 'answer']),
  sdp: z.string().min(1).max(100_000),
});

export const iceCandidateSchema = z.object({
  candidate: z.string().max(2_000),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().int().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});

export const peerInfoSchema = z.object({
  deviceId: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  fingerprint: z.string().min(1).max(128),
});
export type PeerInfo = z.infer<typeof peerInfoSchema>;

const base = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1).max(128),
  ts: z.number().int().nonnegative(),
  from: z.string().min(1).max(128),
});

function message<TType extends string, T extends z.ZodRawShape>(type: TType, shape: T) {
  return base.extend({ type: z.literal(type), ...shape }).strict();
}

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export const authenticateMessage = message('device.authenticate', {
  publicKey: z.string().min(1).max(4096),
  name: z.string().min(1).max(128),
  challengeId: z.string().min(1),
  nonce: z.string().min(1),
  expiresAt: z.number().int(),
  mac: z.string().min(1),
  // Ed25519 signature over the challenge nonce, base64url.
  signature: z.string().min(1).max(4096),
});

export const presenceSetMessage = message('device.presence.set', {
  available: z.boolean(),
});

export const pairingCreateMessage = message('pairing.create', {});

export const pairingJoinMessage = message('pairing.join', {
  code: z.string().min(4).max(16),
});

export const pairingApproveMessage = message('pairing.approve', {
  pairingId: z.string().min(1),
  unattended: z.boolean().default(false),
});

export const pairingRejectMessage = message('pairing.reject', {
  pairingId: z.string().min(1),
});

export const sessionRequestMessage = message('session.request', {
  toDeviceId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  // Signature over `${sessionId}.${toDeviceId}` proving the request origin.
  signature: z.string().min(1).max(4096),
});

export const sessionApproveMessage = message('session.approve', {
  sessionId: z.string().min(1).max(128),
});

export const sessionRejectMessage = message('session.reject', {
  sessionId: z.string().min(1).max(128),
  reason: z.string().max(256).optional(),
});

export const webrtcOfferMessage = message('webrtc.offer', {
  sessionId: z.string().min(1).max(128),
  sdp: sdpSchema,
});

export const webrtcAnswerMessage = message('webrtc.answer', {
  sessionId: z.string().min(1).max(128),
  sdp: sdpSchema,
});

export const webrtcIceMessage = message('webrtc.ice-candidate', {
  sessionId: z.string().min(1).max(128),
  candidate: iceCandidateSchema,
});

export const sessionHeartbeatMessage = message('session.heartbeat', {
  sessionId: z.string().min(1).max(128),
});

export const sessionEndMessage = message('session.end', {
  sessionId: z.string().min(1).max(128),
  reason: z.string().max(256).optional(),
});

export const deviceRevokeMessage = message('device.revoke', {
  targetDeviceId: z.string().min(1).max(128),
});

export const clientMessage = z.discriminatedUnion('type', [
  authenticateMessage,
  presenceSetMessage,
  pairingCreateMessage,
  pairingJoinMessage,
  pairingApproveMessage,
  pairingRejectMessage,
  sessionRequestMessage,
  sessionApproveMessage,
  sessionRejectMessage,
  webrtcOfferMessage,
  webrtcAnswerMessage,
  webrtcIceMessage,
  sessionHeartbeatMessage,
  sessionEndMessage,
  deviceRevokeMessage,
]);
export type ClientMessage = z.infer<typeof clientMessage>;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export const challengeMessage = message('device.challenge', {
  challengeId: z.string().min(1),
  nonce: z.string().min(1),
  expiresAt: z.number().int(),
  mac: z.string().min(1),
});

export const authenticatedMessage = message('device.authenticated', {
  deviceId: z.string().min(1),
  token: z.string().min(1),
  tokenExpiresAt: z.number().int(),
  iceServers: z.array(iceServerSchema),
});

export const presenceUpdateMessage = message('device.presence', {
  deviceId: z.string().min(1),
  online: z.boolean(),
  available: z.boolean(),
});

export const pairingCreatedMessage = message('pairing.created', {
  pairingId: z.string().min(1),
  code: z.string().min(1),
  expiresAt: z.number().int(),
});

export const pairingPendingMessage = message('pairing.pending', {
  pairingId: z.string().min(1),
  peer: peerInfoSchema,
});

export const pairingResultMessage = message('pairing.result', {
  pairingId: z.string().min(1),
  status: z.enum(['approved', 'rejected', 'expired']),
  peer: peerInfoSchema.optional(),
  unattended: z.boolean().optional(),
});

export const sessionIncomingMessage = message('session.incoming', {
  sessionId: z.string().min(1),
  from: peerInfoSchema,
  unattended: z.boolean(),
});

export const sessionApprovedMessage = message('session.approved', {
  sessionId: z.string().min(1),
  iceServers: z.array(iceServerSchema),
  peer: peerInfoSchema,
});

export const sessionRejectedMessage = message('session.rejected', {
  sessionId: z.string().min(1),
  reason: z.string().max(256).optional(),
});

export const sessionEndedMessage = message('session.ended', {
  sessionId: z.string().min(1),
  by: z.enum(['host', 'controller', 'server']),
  reason: z.string().max(256).optional(),
});

export const deviceRevokedMessage = message('device.revoked', {
  // The peer that revoked us, or that we revoked.
  peerDeviceId: z.string().min(1),
});

export const errorMessage = message('error', {
  code: z.string().min(1),
  message: z.string().max(512),
  relatedId: z.string().optional(),
});

export const serverMessage = z.discriminatedUnion('type', [
  challengeMessage,
  authenticatedMessage,
  presenceUpdateMessage,
  pairingCreatedMessage,
  pairingPendingMessage,
  pairingResultMessage,
  sessionIncomingMessage,
  sessionApprovedMessage,
  sessionRejectedMessage,
  sessionEndedMessage,
  deviceRevokedMessage,
  errorMessage,
  // The server also relays webrtc + heartbeat + end messages verbatim.
  webrtcOfferMessage,
  webrtcAnswerMessage,
  webrtcIceMessage,
  sessionHeartbeatMessage,
  sessionEndMessage,
]);
export type ServerMessage = z.infer<typeof serverMessage>;

export const anyMessage = z.union([clientMessage, serverMessage]);
export type AnyMessage = z.infer<typeof anyMessage>;

/** Safe-parse a raw string/object as a client message. */
export function parseClientMessage(raw: unknown): z.SafeParseReturnType<unknown, ClientMessage> {
  return clientMessage.safeParse(raw);
}

/** Safe-parse a raw string/object as a server message. */
export function parseServerMessage(raw: unknown): z.SafeParseReturnType<unknown, ServerMessage> {
  return serverMessage.safeParse(raw);
}
