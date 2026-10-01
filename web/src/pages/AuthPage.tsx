import { FormEvent, ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, User, Waves } from 'lucide-react';
import { login, signup } from '../lib/api';
import { useSession } from '../context/SessionContext';
import ErrorBanner from '../components/ErrorBanner';
import { cx } from '../lib/format';

export default function AuthPage() {
  const { setSession } = useSession();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result =
        mode === 'signup' ? await signup(username, email, password) : await login(email, password);
      setSession({
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      navigate('/channels', { replace: true });
    } catch (err) {
      setError((err as Error).message);
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
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-base p-1">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={cx(
                'rounded-md py-1.5 text-sm font-medium transition-colors',
                mode === 'login' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
              )}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={cx(
                'rounded-md py-1.5 text-sm font-medium transition-colors',
                mode === 'signup' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
              )}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {mode === 'signup' && (
              <Field icon={<User size={16} />}>
                <input
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                />
              </Field>
            )}
            <Field icon={<Mail size={16} />}>
              <input
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
              />
            </Field>
            <Field icon={<Lock size={16} />}>
              <input
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
              />
            </Field>

            {error && <ErrorBanner message={error} />}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-text-muted">
          {mode === 'login' ? (
            <>
              New here?{' '}
              <button onClick={() => setMode('signup')} className="font-medium text-accent hover:underline">
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button onClick={() => setMode('login')} className="font-medium text-accent hover:underline">
                Log in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Field({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-base px-3 py-2.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
      <span className="text-text-muted">{icon}</span>
      {children}
    </div>
  );
}
