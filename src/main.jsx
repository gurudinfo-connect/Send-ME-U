import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';
import './design.css';
import { useUI, applyTheme, applyA11y } from './store';
import * as mock from './data/mock';

applyTheme(useUI.getState().theme);
applyA11y(useUI.getState().settings);
useUI.subscribe((s, prev) => { if (s.settings !== prev.settings) applyA11y(s.settings); });
// Warm the cache with profile pictures while the splash is showing, so chat rows never flash an empty circle
try { [...new Set((JSON.stringify(mock).match(/\/assets\/(?!ob-|stbg-|act-|vid-|call-|lock-|ps-|ch-|mystory)[\w-]+\.png/g) || []))].forEach((u) => { const i = new Image(); i.decoding = 'async'; i.src = u; }); } catch { /* optional */ }

// no saved choice: follow the phone's light/dark setting live
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => { if (!localStorage.getItem('smu_theme')) { applyTheme(e.matches ? 'dark' : 'light'); useUI.setState({ theme: e.matches ? 'dark' : 'light' }); } });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// Installable app: lets Android/iOS "Add to Home Screen" open it full screen, and keeps the shell available offline
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
