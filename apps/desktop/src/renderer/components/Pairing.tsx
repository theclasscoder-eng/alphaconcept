import { useEffect, useState } from 'react';
import { useStore } from '../store.js';

/** Pairing modal: create a code (host), enter a code (join), or approve a joiner. */
export function Pairing({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const pairing = useStore((s) => s.pairing);
  const startHost = useStore((s) => s.startPairingAsHost);
  const join = useStore((s) => s.joinPairing);
  const approve = useStore((s) => s.approvePairing);
  const reject = useStore((s) => s.rejectPairing);
  const cancel = useStore((s) => s.cancelPairing);

  const [code, setCode] = useState('');
  const [unattended, setUnattended] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!pairing.expiresAt) {
      setRemaining(null);
      return;
    }
    const tick = () =>
      setRemaining(Math.max(0, Math.round((pairing.expiresAt! - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pairing.expiresAt]);

  // Auto-close when a pairing resolves back to idle.
  useEffect(() => {
    if (open && pairing.mode === 'none') {
      // keep chooser open; nothing to do
    }
  }, [pairing.mode, open]);

  if (!open && pairing.mode === 'none') return null;

  const close = () => {
    cancel();
    setCode('');
    setUnattended(false);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {pairing.mode === 'none' && (
          <div className="stack">
            <h2 className="h1">Pair a device</h2>
            <p className="muted">Pairing requires both computers to take part.</p>
            <button className="primary" onClick={() => startHost()}>
              Create a pairing code (this is the host)
            </button>
            <div className="row" style={{ marginTop: 8 }}>
              <input
                placeholder="Enter code from the other computer"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && code && join(code)}
              />
              <button disabled={!code} onClick={() => join(code)}>
                Join
              </button>
            </div>
            <button className="ghost" onClick={close}>
              Cancel
            </button>
          </div>
        )}

        {pairing.mode === 'created' && (
          <div className="stack">
            <h2 className="h1">Your pairing code</h2>
            <p className="muted">Enter this on the other computer. It expires shortly.</p>
            <div className="code">{pairing.code ?? '········'}</div>
            {remaining !== null && <p className="muted">Expires in {remaining}s</p>}
            <button className="ghost" onClick={close}>
              Cancel
            </button>
          </div>
        )}

        {pairing.mode === 'joining' && (
          <div className="stack">
            <h2 className="h1">Waiting for approval…</h2>
            <p className="muted">Ask the other computer to approve this device.</p>
            <button className="ghost" onClick={close}>
              Cancel
            </button>
          </div>
        )}

        {pairing.mode === 'approving' && pairing.peer && (
          <div className="stack">
            <h2 className="h1">Approve pairing</h2>
            <p className="muted">A device wants to pair with this computer.</p>
            <div className="card" style={{ margin: 0 }}>
              <div className="row">
                <strong>{pairing.peer.name}</strong>
                <span className="badge">controller</span>
              </div>
              <p className="muted" style={{ margin: '8px 0 4px' }}>
                Verify this fingerprint matches the other device:
              </p>
              <div className="fp">{pairing.peer.fingerprint}</div>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={unattended}
                onChange={(e) => setUnattended(e.target.checked)}
              />
              Allow unattended access from this device
            </label>
            <div className="row">
              <button className="danger" onClick={() => reject()}>
                Reject
              </button>
              <button className="primary" onClick={() => approve(unattended)}>
                Approve
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
