import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Waves } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import ErrorBanner from '../components/ErrorBanner';
import { renderGoogleSignInButton } from '../lib/googleAuth';

export default function AuthPage() {
  const { setSession } = useSession();
  const navigate = useNavigate();
  const buttonContainerRef = useRef<HTMLDivElement>(null);

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
        navigate('/channels', { replace: true });
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
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-base px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Waves size={24} />
          </div>
          <h1 className="text-xl font-bold text-text-primary">
            Orbit<span className="text-accent">Trade</span>
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Voice &amp; chat for traders, built for speed.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-panel p-6 shadow-panel">
          <p className="mb-5 text-center text-sm text-text-secondary">Sign in to continue</p>

          <div className="flex flex-col gap-3">
            {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

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
