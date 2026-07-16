import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { rd } from '../api.js';
import { ConnectionCodes } from './ConnectionCodes.js';
import { Icon } from './Icon.js';

type Tab = 'general' | 'video' | 'connection' | 'security' | 'devices' | 'activity';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'user' },
  { id: 'video', label: 'Video', icon: 'video' },
  { id: 'connection', label: 'Connection', icon: 'link' },
  { id: 'security', label: 'Security', icon: 'shield' },
  { id: 'devices', label: 'Devices', icon: 'key' },
  { id: 'activity', label: 'Activity', icon: 'clock' },
];

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

  const [tab, setTab] = useState<Tab>('general');
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
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">Settings</h1>
          <p className="sub" style={{ margin: 0 }}>
            Identity, connection, video, and security.
          </p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ width: 16, height: 16, display: 'inline-flex' }}>
              <Icon name={t.icon} />
            </span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="tab-panel">
          <div className="card">
            <div className="card-title">Device</div>
            <div className="grid2" style={{ marginTop: 14 }}>
              <label className="field">
                <span className="field-label">Device name</span>
                <div className="row" style={{ gap: 8 }}>
                  <input value={name} onChange={(e) => setLocalName(e.target.value)} />
                  <button className="primary" onClick={() => setName(name)}>
                    Save
                  </button>
                </div>
              </label>
              <label className="field">
                <span className="field-label">Shared monitor (when hosting)</span>
                <select value={selectedMonitorId ?? ''} onChange={(e) => selectMonitor(e.target.value)}>
                  {monitors.map((m, i) => (
                    <option key={m.id} value={m.id}>
                      Monitor {i + 1} — {m.bounds.width}×{m.bounds.height}
                      {m.primary ? ' (primary)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
      )}

      {tab === 'video' && (
        <div className="tab-panel">
          <div className="card">
            <div className="card-title">Video quality</div>
            <div className="grid2" style={{ marginTop: 14 }}>
              <label className="field">
                <span className="field-label">Quality</span>
                <select
                  value={settings.quality}
                  onChange={(e) =>
                    updateSettings({ quality: e.target.value as 'low' | 'balanced' | 'high' })
                  }
                >
                  <option value="low">Low — lightest on data</option>
                  <option value="balanced">Balanced</option>
                  <option value="high">High — sharpest</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Frame rate limit</span>
                <select
                  value={settings.frameRate}
                  onChange={(e) => updateSettings({ frameRate: Number(e.target.value) as 15 | 30 | 60 })}
                >
                  <option value={15}>15 FPS</option>
                  <option value={30}>30 FPS</option>
                  <option value={60}>60 FPS</option>
                </select>
              </label>
            </div>
            <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>
              Lower quality and frame rate use much less bandwidth — useful on a phone hotspot.
            </p>
          </div>
        </div>
      )}

      {tab === 'connection' && (
        <div className="tab-panel">
          <div className="card">
            <div className="card-title">Servers</div>
            <div className="stack" style={{ marginTop: 14 }}>
              <label className="field">
                <span className="field-label">Signaling server URL</span>
                <input
                  value={signalingUrl}
                  onChange={(e) => setSignalingUrl(e.target.value)}
                  onBlur={() => updateSettings({ signalingUrl })}
                />
              </label>
              <div className="grid2">
                <label className="field">
                  <span className="field-label">STUN URL</span>
                  <input
                    value={stunUrl}
                    onChange={(e) => setStunUrl(e.target.value)}
                    onBlur={() => updateSettings({ stunUrl })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">TURN URL (credentials from the server)</span>
                  <input
                    value={turnUrl}
                    onChange={(e) => setTurnUrl(e.target.value)}
                    onBlur={() => updateSettings({ turnUrl })}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="tab-panel">
          <div className="card">
            <div className="card-title">Startup &amp; privacy</div>
            <div className="stack" style={{ marginTop: 14 }}>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={autostart}
                  onChange={async (e) => {
                    const on = await rd.settings.setAutostart(e.target.checked);
                    setAutostart(on);
                  }}
                />
                Start when I sign in to Windows
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
                Stealth — hide this app from screen recording / sharing (still visible to you)
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.clipboardSync}
                  onChange={(e) => updateSettings({ clipboardSync: e.target.checked })}
                />
                Text-only clipboard sync
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.hideOverlay}
                  onChange={(e) => {
                    if (e.target.checked) setHideOverlayWarn(true);
                    else updateSettings({ hideOverlay: false });
                  }}
                />
                Hide the on-screen “session active” banner
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={!settings.hideAdminWarning}
                  onChange={(e) => updateSettings({ hideAdminWarning: !e.target.checked })}
                />
                Show the “run as administrator” reminder
              </label>
            </div>
          </div>

          <div className="card">
            <div className="row">
              <div>
                <div className="card-title">Emergency stop (host)</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Press anywhere to instantly cut input and end a session — you regain control at
                  once.
                </div>
              </div>
              <span className="chip" style={{ fontFamily: 'var(--mono)' }}>
                {shortcut}
              </span>
            </div>
          </div>
        </div>
      )}

      {tab === 'devices' && (
        <div className="tab-panel">
          <div className="card">
            <div className="card-title">Unattended access</div>
            <div className="stack" style={{ marginTop: 14 }}>
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
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Disabled by default; revocable anytime. A device must still be paired and prove its
                private key.
              </p>
            </div>
          </div>

          <ConnectionCodes />

          <div className="card">
            <div className="row">
              <div>
                <div className="card-title">Revoke all devices</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Remove every pairing and unattended grant immediately.
                </div>
              </div>
              <button className="danger" onClick={() => revokeAll()}>
                Revoke all
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="tab-panel">
          <div className="card">
            <div className="row">
              <div>
                <div className="card-title">Session history</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Start/end time, peer, and result. No screen, clipboard, or keystrokes are stored.
                </div>
              </div>
              <button className="ghost" onClick={() => clearHistory()}>
                Clear
              </button>
            </div>
            <div className="stack" style={{ marginTop: 14, gap: 8 }}>
              {history.length === 0 && <div className="muted">No sessions recorded.</div>}
              {history.map((h) => (
                <div className="device" key={h.id} style={{ padding: '11px 14px' }}>
                  <span className="device-name">
                    <Icon name={h.role === 'host' ? 'monitor' : 'user'} />
                    {h.peerName}
                  </span>
                  <span className="muted mono" style={{ fontSize: 11 }}>
                    {new Date(h.startedAt).toLocaleString()} · {h.result}
                    {h.endedBy ? ` · by ${h.endedBy}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {hideOverlayWarn && (
        <div className="modal-backdrop" onClick={() => setHideOverlayWarn(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="stack">
              <h2 className="h1" style={{ color: 'var(--warn)' }}>
                Hide the on-screen banner?
              </h2>
              <p className="muted" style={{ margin: 0 }}>
                The banner lets anyone at this computer see when it’s being controlled. Hiding it
                reduces that visibility.
              </p>
              <div className="card" style={{ margin: 0 }}>
                <div className="field-label" style={{ marginBottom: 8 }}>
                  What stays in place
                </div>
                <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                  <li>
                    The tray icon turns <span style={{ color: 'var(--bad)' }}>red</span> and reads
                    “Remote session active”.
                  </li>
                  <li>Every session is still recorded in history.</li>
                  <li>
                    You can end any session with <b>{shortcut}</b>.
                  </li>
                </ul>
              </div>
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
