import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Waves } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import ErrorBanner from '../components/ErrorBanner';
import { signInWithGoogle, PopupBlockedError, SignInCancelledError } from '../lib/googleAuth';

export default function AuthPage() {
  const { setSession } = useSession();
  const navigate = useNavigate();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGoogleSignIn() {
    setError(null);
    setLoading(true);
    try {
      const result = await signInWithGoogle();
      setSession({
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      navigate('/channels', { replace: true });
    } catch (err) {
      if (err instanceof SignInCancelledError) {
        // User closed the popup themselves — no need to show an error.
      } else if (err instanceof PopupBlockedError) {
        setError(err.message);
      } else {
        setError((err as Error).message || 'Google sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

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

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="flex items-center justify-center gap-2 rounded-lg border border-border bg-base py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                'Please wait…'
              ) : (
                <>
                  <GoogleIcon />
                  Continue with Google
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
