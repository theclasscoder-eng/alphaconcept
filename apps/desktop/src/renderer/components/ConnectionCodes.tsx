import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { rd } from '../api.js';

/**
 * Host-side per-connection code management. For each paired controller the host
 * can require a secret code that the controller must enter live to gain control.
 * Codes are stored encrypted on this computer (never shown back); a breach of the
 * controller device does not reveal them, and each device's code is independent.
 */
export function ConnectionCodes(): JSX.Element {
  const paired = useStore((s) => s.paired);
  const [withCode, setWithCode] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const refresh = () => rd.settings.codeDeviceIds().then(setWithCode);
  useEffect(() => {
    void refresh();
  }, [paired.length]);

  const save = async (deviceId: string) => {
    const code = drafts[deviceId] ?? '';
    await rd.settings.setConnectionCode(deviceId, code.trim() || null);
    setDrafts((d) => ({ ...d, [deviceId]: '' }));
    setSaved(deviceId);
    await refresh();
    setTimeout(() => setSaved(null), 2000);
  };
  const clear = async (deviceId: string) => {
    await rd.settings.setConnectionCode(deviceId, null);
    await refresh();
  };

  return (
    <div className="card">
      <strong>Per-connection codes</strong>
      <div className="muted" style={{ marginTop: 6, marginBottom: 12 }}>
        Require a secret code before a device can control this computer. The controller enters it
        each time (it is never stored on their device), so a breach of one paired computer can’t
        unlock the others.
      </div>
      <div className="stack">
        {paired.length === 0 && <div className="muted">No paired devices.</div>}
        {paired.map((d) => {
          const has = withCode.includes(d.deviceId);
          return (
            <div className="device" key={d.deviceId}>
              <div>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                <div className="mono muted">
                  {has ? '🔒 code required' : 'no code — connects after approval'}
                  {saved === d.deviceId ? ' · saved' : ''}
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="password"
                  placeholder={has ? 'Change code' : 'Set a code'}
                  style={{ width: 160 }}
                  value={drafts[d.deviceId] ?? ''}
                  onChange={(e) => setDrafts((s) => ({ ...s, [d.deviceId]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && save(d.deviceId)}
                />
                <button onClick={() => save(d.deviceId)}>Save</button>
                {has && (
                  <button className="danger" onClick={() => clear(d.deviceId)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
