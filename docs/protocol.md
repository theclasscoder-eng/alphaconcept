# Protocol

All schemas live in `packages/protocol` and are validated with Zod on both ends.
`PROTOCOL_VERSION = 1`; `INPUT_PROTOCOL_VERSION = 1`.

## Signaling envelope

Every signaling message carries:

| field | type | meaning |
| --- | --- | --- |
| `v` | `1` | protocol version (literal; mismatches are rejected) |
| `id` | string | unique message id (uuid); duplicates rejected (replay) |
| `ts` | number | ms epoch; outside a 60 s skew window is rejected |
| `from` | string | sender device id, or `"server"` |
| `type` | string | discriminator (below) |

Messages are `.strict()` — unknown keys are rejected.

### Client → Server

| type | payload |
| --- | --- |
| `device.authenticate` | `publicKey, name, challengeId, nonce, expiresAt, mac, signature` |
| `device.presence.set` | `available` |
| `pairing.create` | — |
| `pairing.join` | `code` |
| `pairing.approve` | `pairingId, unattended` |
| `pairing.reject` | `pairingId` |
| `session.request` | `toDeviceId, sessionId, signature` (signature over `sessionId.toDeviceId`) |
| `session.approve` | `sessionId` |
| `session.reject` | `sessionId, reason?` |
| `webrtc.offer` | `sessionId, sdp:{type:'offer', sdp}` |
| `webrtc.answer` | `sessionId, sdp:{type:'answer', sdp}` |
| `webrtc.ice-candidate` | `sessionId, candidate` |
| `session.heartbeat` | `sessionId` |
| `session.end` | `sessionId, reason?` |
| `device.revoke` | `targetDeviceId` |

### Server → Client

| type | payload |
| --- | --- |
| `device.challenge` | `challengeId, nonce, expiresAt, mac` |
| `device.authenticated` | `deviceId, token, tokenExpiresAt, iceServers[]` |
| `device.presence` | `deviceId, online, available` |
| `pairing.created` | `pairingId, code, expiresAt` |
| `pairing.pending` | `pairingId, peer{deviceId,name,fingerprint}` |
| `pairing.result` | `pairingId, status(approved|rejected|expired), peer?, unattended?` |
| `session.incoming` | `sessionId, from{…}, unattended` |
| `session.approved` | `sessionId, iceServers[], peer{…}` |
| `session.rejected` | `sessionId, reason?` |
| `session.ended` | `sessionId, by(host|controller|server), reason?` |
| `device.revoked` | `peerDeviceId` |
| `error` | `code, message, relatedId?` |
| relayed | `webrtc.offer` / `webrtc.answer` / `webrtc.ice-candidate` / `session.heartbeat` / `session.end` |

The server relays WebRTC/heartbeat/end verbatim between the two session
participants and never inspects SDP.

## Control channel (WebRTC data channel `rdp-control`)

Envelope: `{ v: 1, seq, t, type, … }`, `.strict()`.

| type | payload | notes |
| --- | --- | --- |
| `control.hello` | `role, protocolVersion` | handshake |
| `input.mouse.move` | `p:{nx,ny}` | normalized 0..1, range-checked |
| `input.mouse.button` | `button, action(down|up), p?` | left/middle/right |
| `input.mouse.double` | `button, p` | |
| `input.mouse.scroll` | `dx, dy, p?` | wheel steps |
| `input.key` | `action(down|up), code` | `code` ∈ allowlist (`KEY_CODES`) |
| `input.text` | `text` | length-bounded |
| `input.shortcut` | `modifiers[], code` | chord executed atomically |
| `control.clipboard` | `text` | opt-in, text-only, ≤256 KiB |
| `control.monitor` | `index` | request host monitor switch |

The **host re-validates every control message** (`parseControlMessage`) before
injecting, rate-limits mouse-move, and translates normalized coordinates to the
active display. Invalid version, unknown key codes, out-of-range coordinates, and
malformed shapes are dropped.

## Coordinates

Pointer positions are sent as normalized `[0,1]`. The controller maps viewer
pixels → normalized using the rendered video rect; the host maps normalized →
its display's logical (DIP) space via `normalizedToLogicalPoint`
(`bounds.x + nx*bounds.width`, likewise y). A physical-pixel variant is available
for injectors operating in device pixels. See `packages/protocol/src/coordinates.ts`.

## Auth challenge details

`createAuthChallenge(secret, ttl)` → `{challengeId, nonce, expiresAt, mac}` where
`mac = HMAC-SHA256(secret, challengeId.nonce.expiresAt)`. The client signs `nonce`
with its Ed25519 private key. The server verifies the MAC + freshness, consumes
the nonce once, then verifies the signature against the registered public key.
