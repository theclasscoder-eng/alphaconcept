import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { Pairing } from './Pairing.js';

function statusLabel(status: string): string {
  switch (status) {
    case 'connected':
      return 'Online';
    case 'connecting':
    case 'authenticating':
      return 'Connecting…';
    case 'error':
      return 'Connection error';
    default:
      return 'Offline';
  }
}

export function Dashboard(): JSX.Element {
  const identity = useStore((s) => s.identity);
  const signaling = useStore((s) => s.signaling);
  const settings = useStore((s) => s.settings);
  const paired = useStore((s) => s.paired);
  const presence = useStore((s) => s.presence);
  const history = useStore((s) => s.history);
  const updateSettings = useStore((s) => s.updateSettings);
  const requestSession = useStore((s) => s.requestSession);
  const setUnattended = useStore((s) => s.setUnattended);
  const revokeDevice = useStore((s) => s.revokeDevice);
  const loadHistory = useStore((s) => s.loadHistory);
  const connect = useStore((s) => s.connect);

  const [pairOpen, setPairOpen] = useState(false);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <div>
      <h1 className="h1">This computer</h1>
      <p className="sub">Host or control a paired computer over an encrypted connection.</p>

      <div className="card">
        <div className="row">
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{identity?.name ?? '—'}</div>
            <div className="mono muted" style={{ marginTop: 4 }}>
              {identity?.deviceId ?? ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div>
              <span
                className={`dot ${
                  signaling.status === 'connected'
                    ? 'on'
                    : signaling.status === 'error'
                      ? 'err'
                      : 'off'
                }`}
              />
              {statusLabel(signaling.status)}
            </div>
            {signaling.status !== 'connected' && (
              <button className="ghost" style={{ marginTop: 8 }} onClick={() => connect()}>
                Reconnect
              </button>
            )}
          </div>
        </div>
        <p className="muted" style={{ marginTop: 10, marginBottom: 4 }}>
          Public-key fingerprint (share to verify identity):
        </p>
        <div className="fp">{identity?.fingerprint ?? ''}</div>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <strong>Allow incoming connections (host mode)</strong>
            <div className="muted">Let trusted controllers request to control this computer.</div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings?.allowIncoming ?? false}
              onChange={(e) => updateSettings({ allowIncoming: e.target.checked })}
            />
            {settings?.allowIncoming ? 'On' : 'Off'}
          </label>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <strong>Paired devices</strong>
          <button className="primary" onClick={() => setPairOpen(true)}>
            Pair a device
          </button>
        </div>
        <div className="stack">
          {paired.length === 0 && <div className="muted">No paired devices yet.</div>}
          {paired.map((d) => {
            const p = presence[d.deviceId];
            const online = p?.online ?? false;
            const available = p?.available ?? false;
            return (
              <div className="device" key={d.deviceId}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    <span
                      className={`dot ${online ? (available ? 'on' : 'busy') : 'off'}`}
                    />
                    {d.name}
                  </div>
                  <div className="mono muted">{d.fingerprint.slice(0, 29)}…</div>
                </div>
                <div className="toggle" style={{ gap: 14 }}>
                  <label className="toggle" title="Allow this device unattended access to this computer">
                    <input
                      type="checkbox"
                      checked={d.unattended}
                      onChange={(e) => setUnattended(d.deviceId, e.target.checked)}
                    />
                    Unattended
                  </label>
                  <button
                    className="primary"
                    disabled={!online}
                    onClick={() => requestSession(d.deviceId)}
                  >
                    {online ? 'Connect' : 'Offline'}
                  </button>
                  <button className="danger" onClick={() => revokeDevice(d.deviceId)}>
                    Revoke
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <strong>Recent sessions</strong>
        <div className="stack" style={{ marginTop: 10 }}>
          {history.length === 0 && <div className="muted">No sessions recorded.</div>}
          {history.slice(0, 5).map((h) => (
            <div className="row" key={h.id}>
              <span>
                {h.role === 'host' ? '⭨ Controlled by ' : '⭧ Controlled '}
                {h.peerName}
              </span>
              <span className="muted">
                {new Date(h.startedAt).toLocaleString()} · {h.result}
                {h.unattendedUsed ? ' · unattended' : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Pairing open={pairOpen} onClose={() => setPairOpen(false)} />
    </div>
  );
}
