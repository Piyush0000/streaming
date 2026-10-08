import './lib/authFetch'; // installs the token-refreshing fetch wrapper before anything issues requests
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './premium.css';
import { installVisibilityPause } from './lib/motion';
import { captureJoinSource } from './lib/joinSource';
import { reloadOnceForChunkError } from './lib/errorRecovery';

captureJoinSource();

// A stale tab after a deploy: the lazy route chunk is gone (the server answers with index.html).
// Reload once (guarded against loops) so the user gets the new build instead of a dead screen.
window.addEventListener('vite:preloadError', () => {
  reloadOnceForChunkError();
});

installVisibilityPause();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
