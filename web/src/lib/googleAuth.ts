/**
 * googleAuth.ts
 * Google Identity Services (GIS) — the current library Google recommends for
 * a "Sign in with Google" button, replacing the older popup-based OAuth2
 * implicit flow (response_type=token id_token against /o/oauth2/v2/auth).
 *
 * Why the switch: the old implicit-flow popup kept failing with
 * redirect_uri_mismatch for stream.lr21.org even once the URI was correctly
 * registered and given time to propagate — this matches Google's ongoing
 * lockdown of the legacy implicit grant for newer/updated redirect URIs.
 * GIS sidesteps the problem entirely: it only checks the page's origin
 * against "Authorized JavaScript origins" (already correctly configured),
 * never a redirect URI, and delivers the ID token via postMessage/FedCM
 * instead of a redirect round-trip.
 */
import { loginWithGoogle } from './api';
import type { AuthTokens } from './api';

const GOOGLE_CLIENT_ID = '822203960978-uqdm345u3tn4a6qfnqss3bl08r40u6nf.apps.googleusercontent.com';
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

export class PopupBlockedError extends Error {
  constructor() {
    super('Google sign-in could not open. Please allow popups for this site and try again.');
    this.name = 'PopupBlockedError';
  }
}

export class SignInCancelledError extends Error {
  constructor() {
    super('Sign-in was cancelled.');
    this.name = 'SignInCancelledError';
  }
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          prompt: (
            momentListener?: (notification: {
              isNotDisplayed: () => boolean;
              isSkippedMoment: () => boolean;
              getNotDisplayedReason?: () => string;
              getSkippedReason?: () => string;
            }) => void
          ) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let scriptLoadPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google sign-in script.')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google sign-in script.'));
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

/**
 * Renders Google's own "Sign in with Google" button into `container` and
 * resolves with this app's session tokens once the user completes sign-in.
 * Using Google's rendered button (rather than a custom one that calls
 * `prompt()`) avoids browsers' popup/FedCM blockers, which tend to treat a
 * real Google-rendered button as a trusted first-party UI element.
 */
export async function renderGoogleSignInButton(
  container: HTMLElement,
  options?: { theme?: 'outline' | 'filled_blue' | 'filled_black'; size?: 'large' | 'medium' | 'small' }
): Promise<AuthTokens> {
  await loadGisScript();

  if (!window.google?.accounts?.id) {
    throw new Error('Google sign-in is unavailable right now. Please try again later.');
  }

  return new Promise((resolve, reject) => {
    window.google!.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: async (response) => {
        if (!response.credential) {
          reject(new Error('Google did not return a credential. Please try again.'));
          return;
        }
        try {
          const tokens = await loginWithGoogle(response.credential);
          resolve(tokens);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Google sign-in failed.'));
        }
      },
    });

    window.google!.accounts.id.renderButton(container, {
      theme: options?.theme ?? 'outline',
      size: options?.size ?? 'large',
      type: 'standard',
      width: container.clientWidth || 320,
    });
  });
}
