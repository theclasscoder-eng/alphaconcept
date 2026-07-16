/**
 * Windows elevation helpers.
 *
 * Why this exists: Windows UIPI (User Interface Privilege Isolation) forbids a
 * normal-integrity process from sending input to a HIGHER-integrity window. So
 * when the controller's cursor is over a program the host launched "as
 * Administrator" (Task Manager, installers, many IT/work tools), the injected
 * mouse/keyboard is silently dropped — the local mouse works, the remote one
 * doesn't. Running the host app elevated lets it drive those windows.
 *
 * This is NOT a security bypass: elevation still requires the host user to
 * approve a normal Windows UAC prompt, and even when elevated the app cannot
 * touch the UAC consent secure desktop or the login screen (separate desktops
 * that require a signed service — out of scope and intentionally not bypassed).
 */
import { app } from 'electron';
import { execFile } from 'node:child_process';

let cachedElevated: boolean | null = null;

const PS_CHECK =
  '[bool](([System.Security.Principal.WindowsPrincipal]' +
  '[System.Security.Principal.WindowsIdentity]::GetCurrent())' +
  '.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator))';

function run(cmd: string, args: string[], timeout = 5000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => {
      const code = err && typeof (err as { code?: number }).code === 'number'
        ? (err as { code: number }).code
        : err
          ? 1
          : 0;
      resolve({ code, out: (stdout ?? '').toString().trim() });
    });
  });
}

/** True if the host process is running elevated (admin). Cached after first check. */
export async function isElevated(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  if (cachedElevated !== null) return cachedElevated;
  // Authoritative check via the process token.
  const r = await run('powershell.exe', ['-NoProfile', '-Command', PS_CHECK]);
  if (r.out === 'True') cachedElevated = true;
  else if (r.out === 'False') cachedElevated = false;
  else {
    // Fallback: `net session` succeeds only when elevated.
    const ns = await run('net', ['session']);
    cachedElevated = ns.code === 0;
  }
  return cachedElevated;
}

export type RelaunchResult = 'relaunching' | 'already-elevated' | 'cancelled' | 'unsupported';

/**
 * Relaunch this app elevated. Triggers a UAC prompt on the host. If the user
 * approves, the current (non-elevated) instance quits and the elevated one takes
 * over; if they cancel, nothing changes and 'cancelled' is returned.
 */
export async function relaunchElevated(): Promise<RelaunchResult> {
  if (process.platform !== 'win32') return 'unsupported';
  if (await isElevated()) return 'already-elevated';

  const exe = process.execPath;
  // Preserve args (in dev, execPath is electron.exe and argv[1] is the app dir).
  // Add --allow-multi so the elevated instance skips the single-instance lock
  // (this non-elevated instance still holds it during the UAC handover).
  const args = [...process.argv.slice(1).filter((a) => a !== '.'), '--allow-multi'];
  const argList =
    ' -ArgumentList @(' + args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',') + ')';
  const psCmd = `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -Verb RunAs${argList}`;

  const r = await run('powershell.exe', ['-NoProfile', '-Command', psCmd], 60_000);
  if (r.code === 0) {
    // The elevated instance is starting; step aside. RDP_ALLOW_MULTI lets both
    // coexist for the brief handover; otherwise the single-instance lock applies.
    setTimeout(() => app.exit(0), 400);
    return 'relaunching';
  }
  // Non-zero exit == user cancelled the UAC prompt (or it failed).
  return 'cancelled';
}
