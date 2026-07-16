import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { Indicator } from './components/Indicator.js';
import { useStore } from './store.js';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');
const root = ReactDOM.createRoot(rootEl);

if (window.location.hash.includes('indicator')) {
  // Frameless overlay window.
  root.render(<Indicator />);
} else {
  void useStore.getState().init();
  root.render(<App />);
}
