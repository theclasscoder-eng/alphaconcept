# Running the signaling server as a service (optional)

The **signaling server** (headless Node) is the natural background service. The
desktop app is an interactive GUI program and is **not** run as a service (Windows
session-0 isolation gives services no desktop/GUI).

Across managers, the identity is uniform — **Service Name, Display Name, and
Description all use `AlphaConcept`** (see `packages/config` → `SERVICE`).

## Windows (Service Control Manager)

Prereqs: build the server (`pnpm --filter @rdp/signaling build`) and a valid
`.env` at the repo root. Node isn't service-aware, so we use
[NSSM](https://nssm.cc) as the service host (`winget install NSSM`).

```powershell
# Elevated PowerShell:
.\Install-AlphaConceptService.ps1 -RepoRoot "C:\AlphaConcept"
# Appears in services.msc as "AlphaConcept". Remove with:
.\Uninstall-AlphaConceptService.ps1
```

## Linux (systemd)

```bash
sudo cp ../alphaconcept.service /etc/systemd/system/AlphaConcept.service
sudo systemctl daemon-reload
sudo systemctl enable --now AlphaConcept
systemctl status AlphaConcept
```

## Notes

- This is a **visible, named, removable** service — not covert persistence. It
  shows up in `services.msc` / `systemctl` as `AlphaConcept` and requires admin
  to install or remove.
- Only install this where you actually want the signaling server always-on
  (e.g. a home server or VPS). For casual LAN use, `start-signaling.cmd` is
  simpler and needs no service.
