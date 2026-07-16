/**
 * Wire codec for the signaling channel.
 *
 * On a LAN the signaling WebSocket is `ws://` (plaintext), so a packet sniffer
 * could otherwise read message `type` values like "webrtc.offer" or
 * "session.request" and immediately tell the traffic is a remote-control session.
 * This codec replaces the `type` value with a short, opaque, deterministic code
 * on the wire (and shortens the envelope keys), so casual inspection reveals
 * nothing about intent — while the self-hosted server still decodes it normally.
 *
 * IMPORTANT: this is obfuscation / defense-in-depth, NOT a substitute for
 * transport encryption. For real protection against packet capture, point the
 * app at a `wss://` signaling URL (TLS). See docs/security.md.
 *
 * The codes are derived deterministically from the type string, so the map stays
 * in sync automatically as message types are added.
 */
import { createHash } from 'node:crypto';
import { SIGNALING_TYPES } from './signaling.js';

function codeFor(type: string): string {
  return createHash('sha256').update(`rdp-wire:${type}`).digest('hex').slice(0, 6);
}

const TYPE_TO_CODE = new Map<string, string>();
const CODE_TO_TYPE = new Map<string, string>();
for (const t of SIGNALING_TYPES) {
  const c = codeFor(t);
  if (CODE_TO_TYPE.has(c)) throw new Error(`wire code collision for ${t}`);
  TYPE_TO_CODE.set(t, c);
  CODE_TO_TYPE.set(c, t);
}

/** Short envelope keys used on the wire (semantic <-> compact). */
const TYPE_KEY = 'e';
const KEY_TO_SHORT = new Map<string, string>([
  ['v', 'a'],
  ['id', 'b'],
  ['ts', 'c'],
  ['from', 'd'],
  ['type', TYPE_KEY],
]);
const SHORT_TO_KEY = new Map<string, string>(
  [...KEY_TO_SHORT.entries()].map(([k, v]) => [v, k]),
);

/**
 * Encode a semantic message into its compact wire form: the five envelope keys
 * are shortened, `type` becomes an opaque code, and the payload is grouped under
 * `p`. This removes the message-type names ("webrtc.offer", "session.request",
 * …) that would otherwise identify a remote-control session on a plaintext
 * (`ws://`) link. Payload VALUES (e.g. SDP) are not altered.
 */
export function encodeWire(msg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const payload: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(msg)) {
    if (k === 'type') {
      out[TYPE_KEY] = TYPE_TO_CODE.get(String(val)) ?? String(val);
    } else {
      const short = KEY_TO_SHORT.get(k);
      if (short) out[short] = val;
      else payload[k] = val;
    }
  }
  if (Object.keys(payload).length > 0) out.p = payload;
  return out;
}

/**
 * Decode a compact wire message back to its semantic form. If the input already
 * looks semantic (or isn't our compact shape), it is returned unchanged so the
 * server interoperates during a rollout.
 */
export function decodeWire(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if ('type' in obj && 'v' in obj) return obj; // already semantic
  if (!(TYPE_KEY in obj)) return obj; // not our compact shape

  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (k === 'p' && val && typeof val === 'object') {
      Object.assign(out, val as Record<string, unknown>);
    } else if (k === TYPE_KEY) {
      out.type = CODE_TO_TYPE.get(String(val)) ?? String(val);
    } else {
      const full = SHORT_TO_KEY.get(k);
      if (full) out[full] = val;
      else out[k] = val;
    }
  }
  return out;
}
