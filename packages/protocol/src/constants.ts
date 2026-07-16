/**
 * Protocol-wide constants shared by every component.
 *
 * The protocol version is a single integer. Any breaking change to a message
 * schema MUST bump this number; peers reject messages whose version they do not
 * understand (see `PROTOCOL_VERSION` checks in the signaling client/server).
 */
export const PROTOCOL_VERSION = 1 as const;

/** Data-channel protocol version for the input-control channel. */
export const INPUT_PROTOCOL_VERSION = 1 as const;

/** Named data channel used exclusively for validated remote-control events. */
export const CONTROL_CHANNEL_LABEL = 'rdp-control' as const;

/** Maximum age (ms) a signaling message timestamp may be from server "now". */
export const MAX_MESSAGE_CLOCK_SKEW_MS = 60_000;

/** Pairing codes are short and human enterable; they expire quickly. */
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_CODE_TTL_MS = 3 * 60_000; // 3 minutes

/** Session authorization requests expire if not answered. */
export const SESSION_REQUEST_TTL_MS = 60_000;

/** Device auth challenge lifetime. */
export const CHALLENGE_TTL_MS = 30_000;

/** Issued session-token lifetime (short; refreshed on reconnect). */
export const SESSION_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

/** Clipboard sync payload cap (text-only). */
export const MAX_CLIPBOARD_BYTES = 256 * 1024; // 256 KiB

/** Upper bound on control-channel message size to reject oversized payloads. */
export const MAX_CONTROL_MESSAGE_BYTES = 8 * 1024;

/** Default input event rate cap (events/second) for mouse-move flooding. */
export const DEFAULT_MOUSE_MOVE_RATE = 240;

/** Frame-rate options exposed in the UI. */
export const FRAME_RATE_OPTIONS = [15, 30, 60] as const;
export type FrameRate = (typeof FRAME_RATE_OPTIONS)[number];

/** Quality presets mapped to encoder bitrate targets (bits/second). */
export const QUALITY_PRESETS = {
  low: { maxBitrate: 800_000, label: 'Low' },
  balanced: { maxBitrate: 2_500_000, label: 'Balanced' },
  high: { maxBitrate: 8_000_000, label: 'High' },
} as const;
export type QualityLevel = keyof typeof QUALITY_PRESETS;
