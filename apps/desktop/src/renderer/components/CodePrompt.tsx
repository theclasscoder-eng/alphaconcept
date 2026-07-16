import { useState } from 'react';
import { useStore } from '../store.js';

/**
 * Controller-side prompt for the host's per-connection code. The code is entered
 * live and never stored on this device — only a session-bound HMAC proof is sent.
 */
export function CodePrompt(): JSX.Element | null {
  const codePrompt = useStore((s) => s.codePrompt);
  const submit = useStore((s) => s.submitConnectionCode);
  const endSession = useStore((s) => s.endSession);
  const [code, setCode] = useState('');

  if (!codePrompt.open) return null;

  const send = () => {
    if (code) void submit(code);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="stack">
          <h2 className="h1">Connection code required</h2>
          <p className="muted" style={{ margin: 0 }}>
            This computer is protected with a per-connection code. Enter it to gain control. The
            code is checked on the other computer and never leaves this one in the clear.
          </p>
          <input
            type="password"
            autoFocus
            placeholder="Enter connection code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          {codePrompt.error && (
            <div style={{ color: 'var(--red)', fontSize: 13 }}>{codePrompt.error}</div>
          )}
          <div className="row">
            <button className="ghost" onClick={() => endSession('cancelled at code prompt')}>
              Cancel
            </button>
            <button className="primary" disabled={!code} onClick={send}>
              Unlock
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
