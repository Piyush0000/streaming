import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Copy, ExternalLink, Waves } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import ErrorBanner from '../components/ErrorBanner';
import { renderGoogleSignInButton } from '../lib/googleAuth';
import { clearPostLoginPath, resolvePostLoginTarget } from '../lib/redirect';
import { chromeIntentUrl, isAndroid, isInAppBrowser } from '../lib/inAppBrowser';
import { copyText } from '../lib/clipboard';
import { useToast } from '../context/ToastContext';

export default function AuthPage() {
  const { setSession } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const buttonContainerRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const inApp = isInAppBrowser(ua);
  const intent = inApp && isAndroid(ua) ? chromeIntentUrl(window.location.href) : null;

  async function copyPageLink() {
    const ok = await copyText(window.location.href);
    showToast(ok ? 'Link copied. Paste it in Chrome or Safari.' : `Copy this link: ${window.location.href}`, ok ? 'success' : 'info');
  }

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      if (!buttonContainerRef.current) return;
      try {
        const resultPromise = renderGoogleSignInButton(buttonContainerRef.current, { theme: 'filled_black' });
        if (!cancelled) setReady(true);
        const result = await resultPromise;
        if (cancelled) return;
        setSession({
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        });
        // Return to the page the user was headed for (e.g. an invite link); falls back to /channels.
        const target = resolvePostLoginTarget((location.state as { from?: unknown } | null)?.from);
        clearPostLoginPath();
        navigate(target, { replace: true });
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Google sign-in failed. Please try again.');
      }
    }

    setup();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-[100dvh] w-full animate-fade-in items-center justify-center bg-base px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex animate-rise-in flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Waves size={24} />
          </div>
          <h1 className="text-xl font-bold text-text-primary">
            ELON<span className="text-accent">IX</span>
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Voice &amp; chat for traders, built for speed.
          </p>
        </div>

        <div className="animate-rise-in rounded-xl border border-border bg-panel p-6 shadow-panel" style={{ animationDelay: '120ms' }}>
          <p className="mb-5 text-center text-sm text-text-secondary">Sign in to continue</p>

          <div className="flex flex-col gap-3">
            {inApp && (
              <div role="note" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-left text-xs leading-relaxed text-text-primary">
                <p className="font-semibold text-warning">Google sign-in is blocked inside this app</p>
                <p className="mt-1 text-text-secondary">
                  Instagram, Facebook and similar apps use a limited browser that Google does not allow. Open this page in Chrome or Safari to sign in
                  (tap the menu, then &quot;Open in browser&quot;).
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {intent && (
                    <a href={intent} className="tap inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white">
                      <ExternalLink size={13} aria-hidden /> Open in Chrome
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => void copyPageLink()}
                    className="tap inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-primary hover:bg-hover"
                  >
                    <Copy size={13} aria-hidden /> Copy link
                  </button>
                </div>
              </div>
            )}
            {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
            {error && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="tap rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text-primary hover:bg-hover"
              >
                Try again
              </button>
            )}

            {/* Google renders its own button into this container via GIS —
                see lib/googleAuth.ts for why we don't build a custom one. */}
            <div ref={buttonContainerRef} className="flex min-h-[40px] w-full items-center justify-center" />
            {!ready && !error && (
              <p className="text-center text-xs text-text-muted">Loading Google sign-in…</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
