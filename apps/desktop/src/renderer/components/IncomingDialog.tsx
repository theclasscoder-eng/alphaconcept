import { useState } from 'react';
import { useStore } from '../store.js';

/** Host-side approval dialog for an incoming session request. */
export function IncomingDialog(): JSX.Element | null {
  const session = useStore((s) => s.session);
  const approve = useStore((s) => s.approveIncoming);
  const reject = useStore((s) => s.rejectIncoming);
  const setUnattended = useStore((s) => s.setUnattended);
  const [allowUnattended, setAllowUnattended] = useState(false);

  if (session.phase !== 'incoming' || session.role !== 'host' || !session.peer) return null;

  const onApprove = async () => {
    if (allowUnattended && session.peer) await setUnattended(session.peer.deviceId, true);
    await approve();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="stack">
          <h2 className="h1">Incoming remote session</h2>
          <p className="muted">A trusted device is requesting to control this computer.</p>
          <div className="card" style={{ margin: 0 }}>
            <div className="row">
              <strong>{session.peer.name}</strong>
              <span className="badge">requested {new Date().toLocaleTimeString()}</span>
            </div>
            <p className="muted" style={{ margin: '8px 0 4px' }}>
              Device fingerprint:
            </p>
            <div className="fp">{session.peer.fingerprint}</div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={allowUnattended}
              onChange={(e) => setAllowUnattended(e.target.checked)}
            />
            Allow unattended access from this device in future
          </label>
          <div className="row">
            <button className="danger" onClick={() => reject('declined')}>
              Reject
            </button>
            <button className="primary" onClick={onApprove}>
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
