# CLAUDE.md — repository conventions & commands

Monorepo for AlphaConcept, a Windows-first WebRTC remote-control app. pnpm workspaces + strict
TypeScript. Read `PROJECT_STATE.md` for current status.

**MANDATORY: read `HANDOFF.md` at the start of every session, and update it (sections + dated
Session Log entry) every time anything is done — code, config, docs, decisions, or verifications.**

## Workspace

- Packages: `@rdp/protocol`, `@rdp/shared`, `@rdp/config`, `@rdp/signaling`,
  `@rdp/desktop`.
- Build order: the three `packages/*` must be built before typechecking/building
  `services/signaling` and `apps/desktop` (they consume the compiled `dist`).

## Commands

```bash
pnpm install
pnpm --filter @rdp/protocol --filter @rdp/shared --filter @rdp/config build   # build shared libs first
pnpm lint
pnpm typecheck
pnpm test
pnpm build

# Signaling
pnpm --filter @rdp/signaling dev        # tsx watch (needs JWT_SECRET, DEVICE_CHALLENGE_SECRET)
pnpm --filter @rdp/signaling test       # ws integration tests (in-memory store)
pnpm --filter @rdp/signaling db:generate
pnpm --filter @rdp/signaling db:migrate

# Desktop
pnpm --filter @rdp/desktop dev
pnpm --filter @rdp/desktop typecheck    # node + web projects
pnpm --filter @rdp/desktop build
pnpm --filter @rdp/desktop package      # NSIS installer
pnpm --filter @rdp/desktop package:dir  # unpacked app
```

## Conventions

- **ESM** everywhere; relative imports use `.js` extensions (TS `Bundler`/NodeNext
  resolution). Vitest/Vite resolve `.js` → `.ts` automatically.
- **Strict TS**: `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, etc.
- **Trust boundaries validate with Zod**: signaling messages, control messages,
  and every IPC handler argument.
- **Renderer is browser-only**: import protocol values from `@rdp/protocol/browser`
  (never the root barrel, which pulls in `node:crypto`).
- **Private key stays in main**; renderer signs nothing directly.
- **Distributive Omit** is needed when stripping envelope keys from the message
  discriminated unions (see `OutgoingSignal`, `ControlInput`).
- Desktop packaging: workspace packages are **bundled into the main bundle**
  (electron-vite `externalizeDepsPlugin({ exclude: [...] })`) and `asar: false`,
  to avoid electron-builder rejecting pnpm workspace symlinks.

## Testing notes

- Signaling integration tests build a real Fastify+ws server on an ephemeral port
  with the in-memory repository; the test WS client attaches its message handler
  before the socket opens (the server sends the challenge immediately).
- Pure logic (crypto, coordinates, rate limiting, input validation/throttling,
  message schemas) is unit-tested and does not require Electron or Postgres.

## Security guardrails (do not regress)

- No plaintext secrets; no hardcoded JWT/TURN/pairing secrets.
- Keep `contextIsolation: true`, `nodeIntegration: false`, CSP, and the narrow
  preload bridge.
- No remote shell/process execution; no keylogging outside an active session; no
  persistence beyond the explicit login-item setting; no UAC/AV/firewall bypass.
- Stealth = `setContentProtection` only.
