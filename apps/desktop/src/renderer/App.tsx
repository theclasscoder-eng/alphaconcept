import { useState } from 'react';
import { useStore } from './store.js';
import { Dashboard } from './components/Dashboard.js';
import { Settings } from './components/Settings.js';
import { IncomingDialog } from './components/IncomingDialog.js';
import { Viewer } from './components/Viewer.js';

type Page = 'dashboard' | 'settings';

export function App(): JSX.Element {
  const [page, setPage] = useState<Page>('dashboard');
  const banner = useStore((s) => s.banner);
  const dismiss = useStore((s) => s.dismissBanner);
  const signaling = useStore((s) => s.signaling);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">🖥️ AlphaConcept</div>
        <button
          className={`nav-item${page === 'dashboard' ? ' active' : ''}`}
          onClick={() => setPage('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={`nav-item${page === 'settings' ? ' active' : ''}`}
          onClick={() => setPage('settings')}
        >
          Settings
        </button>
        <div style={{ flex: 1 }} />
        <div className="muted" style={{ padding: '10px 12px', fontSize: 12 }}>
          <span
            className={`dot ${signaling.status === 'connected' ? 'on' : signaling.status === 'error' ? 'err' : 'off'}`}
          />
          Signaling: {signaling.status}
        </div>
      </aside>

      <main className="main">{page === 'dashboard' ? <Dashboard /> : <Settings />}</main>

      <IncomingDialog />
      <Viewer />

      {banner && (
        <div className="banner">
          {banner}{' '}
          <button className="ghost" style={{ marginLeft: 10, padding: '2px 8px' }} onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
