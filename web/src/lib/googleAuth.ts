/**
 * googleAuth.ts
 * Popup-based Google OAuth2 implicit flow, adapted from the pattern already
 * proven in LR21's GoogleAuthService.ts. Opens Google's consent popup,
 * polls it for the id_token that lands in the redirected URL's fragment,
 * then hands that token to this app's own `/google` backend route (which
 * verifies it server-side — the frontend never trusts anything out of the
 * popup beyond "here's an id_token, go check it").
 */
import { loginWithGoogle } from './api';
import type { AuthTokens } from './api';

// Same Google Cloud OAuth client LR21 already uses — intentionally reused
// so a new Google Cloud project isn't needed. Client IDs aren't secret.
const GOOGLE_CLIENT_ID = '822203960978-uqdm345u3tn4a6qfnqss3bl08r40u6nf.apps.googleusercontent.com';

export class PopupBlockedError extends Error {
  constructor() {
    super('Popup was blocked. Please allow popups for this site and try again.');
    this.name = 'PopupBlockedError';
  }
}

export class SignInCancelledError extends Error {
  constructor() {
    super('Sign-in was cancelled.');
    this.name = 'SignInCancelledError';
  }
}

function openGooglePopup(): Window {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: window.location.origin,
    response_type: 'token id_token',
    scope: 'openid email profile',
    nonce: Math.random().toString(36).substring(2),
    prompt: 'select_account',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const popup = window.open(
    authUrl,
    'google-signin',
    'width=500,height=600,top=100,left=200,scrollbars=yes,resizable=yes'
  );

  if (!popup) {
    throw new PopupBlockedError();
  }
  return popup;
}

/** Opens the Google sign-in popup, waits for the id_token, and exchanges it
 * with this app's backend for our own session tokens. */
export function signInWithGoogle(): Promise<AuthTokens> {
  return new Promise((resolve, reject) => {
    let popup: Window;
    try {
      popup = openGooglePopup();
    } catch (err) {
      reject(err);
      return;
    }

    let resolved = false;

    const pollInterval = window.setInterval(async () => {
      try {
        if (popup.closed) {
          if (!resolved) {
            window.clearInterval(pollInterval);
            reject(new SignInCancelledError());
          }
          return;
        }

        const popupUrl = popup.location?.href || '';
        if (!popupUrl.includes('id_token')) return;

        window.clearInterval(pollInterval);
        resolved = true;
        popup.close();

        const hash = popupUrl.split('#')[1] || popupUrl.split('?')[1] || '';
        const hashParams = new URLSearchParams(hash);
        const idToken = hashParams.get('id_token');

        if (!idToken) {
          reject(new Error('Google did not return an id_token. Please try again.'));
          return;
        }

        try {
          const tokens = await loginWithGoogle(idToken);
          resolve(tokens);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Google sign-in failed.'));
        }
      } catch {
        // Cross-origin errors are expected while the popup is on Google's
        // domain — keep polling until it redirects back to our origin.
      }
    }, 300);

    // Timeout safety net (2 minutes) in case the popup never closes or
    // redirects (e.g. user leaves it idle on the consent screen).
    window.setTimeout(() => {
      if (!resolved) {
        window.clearInterval(pollInterval);
        if (!popup.closed) popup.close();
        reject(new Error('Sign-in timed out. Please try again.'));
      }
    }, 120_000);
  });
}
