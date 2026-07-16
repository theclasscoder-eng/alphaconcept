import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { Pairing } from './Pairing.js';
import { ElevationCard } from './ElevationCard.js';
import { Icon } from './Icon.js';

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

  const online = signaling.status === 'connected';
  const tone = online ? 'on' : signaling.status === 'error' ? 'err' : 'off';
  const onlineCount = paired.filter((d) => presence[d.deviceId]?.online).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">This computer</h1>
          <p className="sub" style={{ margin: 0 }}>
            Host or control a paired computer over an encrypted connection.
          </p>
        </div>
        <button className="primary" onClick={() => setPairOpen(true)}>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 16, height: 16, display: 'inline-flex' }}>
              <Icon name="plus" />
            </span>
            Pair a device
          </span>
        </button>
      </div>

      <ElevationCard />

      {/* Identity + status summary */}
      <div className="card accent">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="eyebrow">This device</div>
            <div style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-0.02em', marginTop: 4 }}>
              {identity?.name ?? '—'}
            </div>
            <div className="mono muted" style={{ marginTop: 3 }}>
              {identity?.deviceId ?? ''}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <span className="chip">
              <span className={`dot ${tone}`} />
              {online ? 'Connected' : signaling.status === 'error' ? 'Offline' : 'Connecting…'}
            </span>
            {!online && (
              <button className="ghost" onClick={() => connect()}>
                Reconnect
              </button>
            )}
          </div>
        </div>
        <div className="field-label" style={{ marginTop: 16 }}>
          Fingerprint — share to verify this device
        </div>
        <div className="fp">{identity?.fingerprint ?? ''}</div>
      </div>

      {/* Host availability */}
      <div className="card">
        <div className="row">
          <div>
            <div className="card-title">Allow incoming connections</div>
            <div className="muted" style={{ marginTop: 4 }}>
              Let trusted devices request to control this computer (host mode).
            </div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings?.allowIncoming ?? false}
              onChange={(e) => updateSettings({ allowIncoming: e.target.checked })}
            />
            <span style={{ minWidth: 22 }}>{settings?.allowIncoming ? 'On' : 'Off'}</span>
          </label>
        </div>
      </div>

      {/* Paired devices */}
      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="card-title">Paired devices</div>
          {paired.length > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>
              {onlineCount} of {paired.length} online
            </span>
          )}
        </div>
        <div className="stack" style={{ gap: 10 }}>
          {paired.length === 0 && (
            <div className="muted" style={{ padding: '8px 2px' }}>
              No paired devices yet. Choose “Pair a device” to connect your first computer.
            </div>
          )}
          {paired.map((d) => {
            const p = presence[d.deviceId];
            const isOnline = p?.online ?? false;
            const available = p?.available ?? false;
            return (
              <div className="device" key={d.deviceId}>
                <div>
                  <div className="device-name">
                    <span className={`dot ${isOnline ? (available ? 'on' : 'busy') : 'off'}`} />
                    {d.name}
                  </div>
                  <div className="mono muted" style={{ marginTop: 3, fontSize: 11 }}>
                    {d.fingerprint.slice(0, 29)}…
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <label
                    className="toggle"
                    style={{ fontSize: 12, color: 'var(--text-2)' }}
                    title="Allow this device unattended access to this computer"
                  >
                    <input
                      type="checkbox"
                      checked={d.unattended}
                      onChange={(e) => setUnattended(d.deviceId, e.target.checked)}
                    />
                    Unattended
                  </label>
                  <button className="primary" disabled={!isOnline} onClick={() => requestSession(d.deviceId)}>
                    {isOnline ? 'Connect' : 'Offline'}
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

      {/* Recent sessions */}
      <div className="card">
        <div className="card-title">Recent sessions</div>
        <div className="stack" style={{ marginTop: 12, gap: 8 }}>
          {history.length === 0 && <div className="muted">No sessions recorded.</div>}
          {history.slice(0, 5).map((h) => (
            <div className="row" key={h.id} style={{ padding: '2px 0' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 15, height: 15, display: 'inline-flex', color: 'var(--text-3)' }}>
                  <Icon name={h.role === 'host' ? 'monitor' : 'user'} />
                </span>
                {h.role === 'host' ? 'Controlled by ' : 'Controlled '}
                {h.peerName}
              </span>
              <span className="muted mono" style={{ fontSize: 11 }}>
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
