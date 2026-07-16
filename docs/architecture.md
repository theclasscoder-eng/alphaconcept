# Architecture

## Overview

Remote Desktop is a Windows-first remote administration tool with two roles that
ship in one app: **host** (screen is shared and controlled) and **controller**
(views and controls a host). Media and input travel peer-to-peer over WebRTC; a
small signaling service only helps two authenticated, paired devices find each
other and exchange connection metadata.

```
        ┌─────────────────────────────┐        ┌─────────────────────────────┐
        │  Controller (Electron)      │        │  Host (Electron)            │
        │                             │        │                             │
        │  Renderer (React)           │        │  Renderer (React)           │
        │   • RTCPeerConnection       │        │   • RTCPeerConnection       │
        │   • <video> of host screen  │        │   • getUserMedia(desktop)   │
        │   • input capture ──────────┼──┐  ┌──┼─► control channel ► inject  │
        │                             │  │  │  │                             │
        │  Main (Node)                │  │  │  │  Main (Node)                │
        │   • device identity/keys    │  │  │  │   • nut-js input injection  │
        │   • signaling WS client     │  │  │  │   • desktopCapturer sources │
        └───────────┬─────────────────┘  │  │  └───────────┬─────────────────┘
                    │ WSS (metadata only) │  │              │ WSS (metadata only)
                    ▼                     │  │              ▼
        ┌───────────────────────────────────────────────────────────────────┐
        │  Signaling service (Fastify + ws)  — never sees media/input        │
        │  Postgres (devices, trust, unattended)  ·  Redis (optional)        │
        └───────────────────────────────────────────────────────────────────┘
                    ▲                     │  │              ▲
                    └── STUN (reflex) ────┘  └── TURN (relay when needed) ────┘
```

WebRTC media (screen) uses SRTP; the input/clipboard **data channel** uses DTLS.
Both are end-to-end encrypted between the two peers.

## Monorepo layout

```
apps/desktop            Electron app (main / preload / renderer / host / controller / security / platform)
services/signaling      Fastify signaling service (+ Prisma schema, tests)
packages/protocol       Versioned Zod message schemas, Ed25519 identity, coordinate math, rate limiter
packages/shared         Log redaction, TURN credential derivation
packages/config         Validated ICE/STUN/TURN config
infrastructure          docker-compose, coturn, deployment examples
docs                    This documentation
```

## Desktop process model

- **Main (Node/Electron):** owns the device identity and **private key** (never
  exposed to the renderer), the signaling WebSocket, OS input injection
  (`@nut-tree-fork/nut-js`), monitor enumeration (`desktopCapturer` + `screen`),
  secure storage (`safeStorage`/DPAPI), the tray + emergency-stop shortcut, the
  "session active" indicator window, stealth (content protection), and the local
  audit log.
- **Preload:** a single `contextBridge` exposing a typed, narrow API on
  `window.remoteDesktop`. No raw `ipcRenderer`, Node, `fs`, or `child_process`.
- **Renderer (React + Zustand):** UI and all WebRTC (`RTCPeerConnection`,
  `getUserMedia`, video rendering, data-channel send/receive). It asks main to
  inject validated input and to sign session requests.

### Why WebRTC lives in the renderer

`RTCPeerConnection`/`getUserMedia` exist only in Chromium (the renderer).
`desktopCapturer` and OS input injection exist only in the main process. So the
renderer captures/renders and the main process enumerates sources and injects
input; they cooperate over the typed IPC bridge.

## Signaling service

Transport-agnostic `SignalingHub` drives all logic (auth, pairing, sessions,
relay, presence, revocation, rate limiting, replay protection). A thin Fastify +
`@fastify/websocket` layer wraps each socket in a `Connection`. Data lives behind
a `Repository` interface with two implementations:

- **memory** — zero external dependencies; used for tests/CI and quick local dev.
- **prisma** — Postgres for production.

The server stores only device public identities, short-lived pairing/session
requests, trust relationships, and unattended grants. It never receives screen,
keyboard, or clipboard content.

## Session lifecycle

1. Both devices authenticate to signaling (challenge → Ed25519 signature).
2. Controller sends a **signed** `session.request` to a trusted host.
3. Host approves (dialog) or auto-accepts (host-local unattended allow-list).
4. Server returns ICE servers (STUN + time-limited TURN) to both.
5. Controller creates the offer + control data channel; host answers with its
   screen track. ICE candidates are relayed.
6. Media + input flow peer-to-peer. Host shows the "session active" indicator.
7. Either side ends; capture/input/data channels/peer connection are torn down,
   input injection is disabled immediately, and a non-sensitive audit entry is
   written.

See `docs/protocol.md` for exact message shapes and `docs/security.md` for the
trust and authentication model.
