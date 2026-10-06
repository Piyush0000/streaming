import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { rememberPostLoginPath } from '../lib/redirect';

/** Token + a guard for write actions: logged-out users are sent to /login and return to the current page afterwards. */
export function useHubAuth() {
  const { session, initializing } = useSession();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const token = session?.accessToken ?? null;
  const path = location.pathname + location.search;

  const requireAuth = useCallback((): boolean => {
    if (token) return true;
    rememberPostLoginPath(path);
    showToast('Sign in to join in.', 'info');
    navigate('/login', { state: { from: path } });
    return false;
  }, [token, path, navigate, showToast]);

  return { token, initializing, username: session?.user.username ?? null, userId: session?.user.id ?? null, requireAuth };
}
