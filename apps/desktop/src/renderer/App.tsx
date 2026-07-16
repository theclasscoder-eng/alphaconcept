import { useEffect, useState } from 'react';
import { useStore } from './store.js';
import { Dashboard } from './components/Dashboard.js';
import { Settings } from './components/Settings.js';
import { IncomingDialog } from './components/IncomingDialog.js';
import { Viewer } from './components/Viewer.js';
import { CodePrompt } from './components/CodePrompt.js';
import { Icon } from './components/Icon.js';

type Page = 'dashboard' | 'settings';
type Theme = 'dark' | 'light';

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem('ac-theme') as Theme) || 'dark',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ac-theme', theme);
  }, [theme]);
  return [theme, setThemeState];
}

export function App(): JSX.Element {
  const [page, setPage] = useState<Page>('dashboard');
  const [theme, setTheme] = useTheme();
  const banner = useStore((s) => s.banner);
  const dismiss = useStore((s) => s.dismissBanner);
  const signaling = useStore((s) => s.signaling);

  const online = signaling.status === 'connected';
  const statusTone = online ? 'on' : signaling.status === 'error' ? 'err' : 'off';
  const statusText =
    signaling.status === 'connected'
      ? 'Connected'
      : signaling.status === 'connecting' || signaling.status === 'authenticating'
        ? 'Connecting…'
        : signaling.status === 'error'
          ? 'Offline'
          : 'Offline';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="spark" />
          </span>
          AlphaConcept
        </div>

        <button
          className={`nav-item${page === 'dashboard' ? ' active' : ''}`}
          onClick={() => setPage('dashboard')}
        >
          <Icon name="grid" />
          Dashboard
        </button>
        <button
          className={`nav-item${page === 'settings' ? ' active' : ''}`}
          onClick={() => setPage('settings')}
        >
          <Icon name="sliders" />
          Settings
        </button>

        <div className="rail-foot">
          <div className="rail-status">
            <span className={`dot ${statusTone}`} />
            {statusText}
          </div>
          <div className="theme-toggle" role="group" aria-label="Theme">
            <button
              className={theme === 'light' ? 'active' : ''}
              onClick={() => setTheme('light')}
              aria-label="Light theme"
              title="Light"
            >
              <Icon name="sun" />
            </button>
            <button
              className={theme === 'dark' ? 'active' : ''}
              onClick={() => setTheme('dark')}
              aria-label="Dark theme"
              title="Dark"
            >
              <Icon name="moon" />
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        {/* key forces a remount so the page rise animation plays on switch */}
        <div key={page}>{page === 'dashboard' ? <Dashboard /> : <Settings />}</div>
      </main>

      <IncomingDialog />
      <Viewer />
      <CodePrompt />

      {banner && (
        <div className="banner">
          <Icon name="info" />
          <span>{banner}</span>
          <button
            className="ghost"
            style={{ marginLeft: 6, padding: '4px 10px' }}
            onClick={dismiss}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
