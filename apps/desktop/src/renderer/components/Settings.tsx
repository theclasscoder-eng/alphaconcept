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

  useEffect(() => {
    void loadHistory();
    void refreshMonitors();
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
    </div>
  );
}
