import { createAuthFetch } from './authFetchCore';
import { sessionManager } from './sessionManager';

let installed = false;

/** Wraps window.fetch once. Imported from main.tsx. */
export function installAuthFetch(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  window.fetch = createAuthFetch({
    baseFetch: window.fetch.bind(window),
    manager: sessionManager,
    origin: window.location.origin,
    apiBases: [import.meta.env.VITE_API_BASE_URL, import.meta.env.VITE_UPLOADS_BASE_URL].filter(Boolean) as string[],
    authBases: [import.meta.env.VITE_AUTH_BASE_URL].filter(Boolean) as string[],
  });
}

installAuthFetch();
