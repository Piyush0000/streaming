import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './premium.css';
import { installVisibilityPause } from './lib/motion';
import { captureJoinSource } from './lib/joinSource';

captureJoinSource();

installVisibilityPause();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
