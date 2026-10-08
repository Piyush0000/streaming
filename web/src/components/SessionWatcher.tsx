import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { sessionManager } from '../lib/sessionManager';
import { sanitizeInternalPath } from '../lib/redirect';

export const SESSION_LOST_MESSAGE =
  "You were signed out for security. Please sign in again — you'll come right back to where you were.";

/**
 * Renders nothing. When the session manager reports a DEFINITIVE session loss
 * (refresh token rejected), shows ONE toast and sends the user to /login. The
 * previous path was already remembered by the manager, so login returns there.
 */
export default function SessionWatcher() {
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    return sessionManager.onSessionLost(() => {
      showToast(SESSION_LOST_MESSAGE, 'warning', 10000);
      const here = window.location.pathname;
      if (here === '/login') return;
      const from = sanitizeInternalPath(here + window.location.search + window.location.hash);
      navigate('/login', { replace: true, state: from ? { from } : undefined });
    });
  }, [showToast, navigate]);

  return null;
}
