import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { rd } from '../api.js';

export function Settings(): JSX.Element {
  const identity = useStore((s) => s.identity);
  const settings = useStore((s) => s.settings);
  const paired = useStore((s) => s.paired);
  const history = useStore((s) => s.history);
  const monitors = useStore((s) => s.monitors);
  const selectedMonitorId = useStore((s) => s.selectedMonitorId);
  const setName = useStore((s) => s.setName);
  const updateSettings = useStore((s) => s.updateSettings);
  const setUnattended = useStore((s) => s.setUnattended);
  const revokeAll = useStore((s) => s.revokeAll);
  const selectMonitor = useStore((s) => s.selectMonitor);
  const loadHistory = useStore((s) => s.loadHistory);
  const clearHistory = useStore((s) => s.clearHistory);
  const refreshMonitors = useStore((s) => s.refreshMonitors);

  const [name, setLocalName] = useState('');
  const [signalingUrl, setSignalingUrl] = useState('');
  const [stunUrl, setStunUrl] = useState('');
  const [turnUrl, setTurnUrl] = useState('');
  const [autostart, setAutostart] = useState(false);
  const [stealth, setStealth] = useState(false);
  const [hideOverlayWarn, setHideOverlayWarn] = useState(false);
  const [shortcut, setShortcut] = useState('Ctrl+Alt+F12');

  useEffect(() => {
    void loadHistory();
    void refreshMonitors();
    void rd.session.emergencyShortcut().then(setShortcut);
  }, [loadHistory, refreshMonitors]);
  useEffect(() => {
    if (settings) {
      setLocalName(identity?.name ?? settings.deviceName);
      setSignalingUrl(settings.signalingUrl);
      setStunUrl(settings.stunUrl);
      setTurnUrl(settings.turnUrl);
      setAutostart(settings.startOnLogin);
    }
  }, [settings, identity]);

  if (!settings) return <div className="muted">Loading…</div>;

  return (
    <div>
      <h1 className="h1">Settings</h1>
      <p className="sub">Identity, connection, video, and security options.</p>

      <div className="card">
        <strong>Device</strong>
        <div className="grid2" style={{ marginTop: 12 }}>
          <div>
            <label className="muted">Device name</label>
            <div className="row" style={{ marginTop: 6 }}>
              <input value={name} onChange={(e) => setLocalName(e.target.value)} />
              <button onClick={() => setName(name)}>Save</button>
            </div>
          </div>
          <div>
            <label className="muted">Shared monitor (host)</label>
            <select
              style={{ marginTop: 6 }}
              value={selectedMonitorId ?? ''}
              onChange={(e) => selectMonitor(e.target.value)}
            >
              {monitors.map((m, i) => (
                <option key={m.id} value={m.id}>
                  Monitor {i + 1} — {m.bounds.width}×{m.bounds.height}
                  {m.primary ? ' (primary)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <strong>Startup & privacy</strong>
        <div className="stack" style={{ marginTop: 12 }}>
          <label className="toggle">
            <input
              type="checkbox"
              checked={autostart}
              onChange={async (e) => {
                const on = await rd.settings.setAutostart(e.target.checked);
                setAutostart(on);
              }}
            />
            Start when I sign in to Windows (uses the documented Windows startup mechanism)
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={stealth}
              onChange={async (e) => {
                setStealth(e.target.checked);
                await rd.session.setStealth(e.target.checked);
              }}
            />
            Stealth: exclude this app’s windows from screen recording / sharing (still visible to
            you locally)
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.clipboardSync}
              onChange={(e) => updateSettings({ clipboardSync: e.target.checked })}
            />
            Enable text-only clipboard synchronization
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.hideOverlay}
              onChange={(e) => {
                if (e.target.checked) setHideOverlayWarn(true); // confirm first
                else updateSettings({ hideOverlay: false });
              }}
            />
            Hide the on-screen “Remote session active” banner
          </label>
          <div className="muted" style={{ fontSize: 12, marginLeft: 26 }}>
            The tray icon still turns <span style={{ color: 'var(--red)' }}>red</span> during a
            session and stays visible in the taskbar’s hidden-icons area.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <strong>Emergency stop (host)</strong>
            <div className="muted">
              While someone controls this computer, press this anywhere to instantly cut input and
              end the session — you regain control immediately. Also on the tray menu.
            </div>
          </div>
          <span className="badge green" style={{ fontSize: 14, padding: '6px 12px' }}>
            {shortcut}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <strong>Controlling admin apps</strong>
            <div className="muted">
              Windows blocks remote input to programs run “as administrator” unless this app is
              elevated. Turn the reminder back on if you dismissed it.
            </div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={!settings.hideAdminWarning}
              onChange={(e) => updateSettings({ hideAdminWarning: !e.target.checked })}
            />
            Show reminder
          </label>
        </div>
      </div>

      <div className="card">
        <strong>Video</strong>
        <div className="grid2" style={{ marginTop: 12 }}>
          <div>
            <label className="muted">Quality</label>
            <select
              style={{ marginTop: 6 }}
              value={settings.quality}
              onChange={(e) =>
                updateSettings({ quality: e.target.value as 'low' | 'balanced' | 'high' })
              }
            >
              <option value="low">Low</option>
              <option value="balanced">Balanced</option>
              <option value="high">High</option>
            </select>
          </div>
          <div>
            <label className="muted">Frame rate limit</label>
            <select
              style={{ marginTop: 6 }}
              value={settings.frameRate}
              onChange={(e) =>
                updateSettings({ frameRate: Number(e.target.value) as 15 | 30 | 60 })
              }
            >
              <option value={15}>15 FPS</option>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <strong>Connection</strong>
        <div className="stack" style={{ marginTop: 12 }}>
          <div>
            <label className="muted">Signaling server URL</label>
            <input
              style={{ marginTop: 6 }}
              value={signalingUrl}
              onChange={(e) => setSignalingUrl(e.target.value)}
              onBlur={() => updateSettings({ signalingUrl })}
            />
          </div>
          <div className="grid2">
            <div>
              <label className="muted">STUN URL</label>
              <input
                style={{ marginTop: 6 }}
                value={stunUrl}
                onChange={(e) => setStunUrl(e.target.value)}
                onBlur={() => updateSettings({ stunUrl })}
              />
            </div>
            <div>
              <label className="muted">TURN URL (credentials come from the server)</label>
              <input
                style={{ marginTop: 6 }}
                value={turnUrl}
                onChange={(e) => setTurnUrl(e.target.value)}
                onBlur={() => updateSettings({ turnUrl })}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <strong>Unattended access permissions</strong>
        <div className="stack" style={{ marginTop: 12 }}>
          {paired.length === 0 && <div className="muted">No paired devices.</div>}
          {paired.map((d) => (
            <label className="toggle" key={d.deviceId}>
              <input
                type="checkbox"
                checked={d.unattended}
                onChange={(e) => setUnattended(d.deviceId, e.target.checked)}
              />
              {d.name}
            </label>
          ))}
          <p className="muted">
            Unattended access is disabled by default and can be revoked at any time. A device must
            still be paired and prove possession of its private key to connect.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <strong>Session history</strong>
            <div className="muted">
              Records start/end time, peer, result, and whether unattended access was used. No
              screen, clipboard, or keystroke content is stored.
            </div>
          </div>
          <button className="ghost" onClick={() => clearHistory()}>
            Clear history
          </button>
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          {history.length === 0 && <div className="muted">No sessions recorded.</div>}
          {history.map((h) => (
            <div className="row" key={h.id}>
              <span>
                {h.peerName} · {h.role}
              </span>
              <span className="muted">
                {new Date(h.startedAt).toLocaleString()} · {h.result}
                {h.endedBy ? ` · ended by ${h.endedBy}` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <strong>Revoke all devices</strong>
            <div className="muted">Remove every pairing and unattended grant immediately.</div>
          </div>
          <button className="danger" onClick={() => revokeAll()}>
            Revoke all
          </button>
        </div>
      </div>

      {hideOverlayWarn && (
        <div className="modal-backdrop" onClick={() => setHideOverlayWarn(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="stack">
              <h2 className="h1" style={{ color: 'var(--amber)' }}>⚠ Hide the on-screen banner?</h2>
              <p className="muted" style={{ margin: 0 }}>
                The large “Remote session active” banner exists so anyone at this computer can see
                when it’s being controlled. Hiding it reduces that visibility.
              </p>
              <div className="card" style={{ margin: 0 }}>
                <p style={{ margin: 0 }}>What stays in place:</p>
                <ul className="muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  <li>
                    The tray icon turns <span style={{ color: 'var(--red)' }}>red</span> and its
                    tooltip reads “Remote session active” — visible in the taskbar’s hidden-icons
                    (▲) area.
                  </li>
                  <li>Every session is still recorded in local history.</li>
                  <li>
                    You can end any session instantly with <b>{shortcut}</b>.
                  </li>
                </ul>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Only enable this on a computer you own and control. It is not a way to monitor
                someone without their knowledge.
              </p>
              <div className="row">
                <button className="ghost" onClick={() => setHideOverlayWarn(false)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    updateSettings({ hideOverlay: true });
                    setHideOverlayWarn(false);
                  }}
                >
                  Hide banner (keep tray indicator)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
