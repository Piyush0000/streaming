import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { isChunkLoadError, reloadOnceForChunkError, resetKeysChanged, shouldAutoRecoverLogin } from '../lib/errorRecovery';

type Variant = 'app' | 'section';

interface Props {
  children: ReactNode;
  /** When any entry changes (by identity) while the fallback is showing, the boundary resets itself. */
  resetKeys?: readonly unknown[];
  variant?: Variant;
  /** Label used in the console log, e.g. "app" or "hub". */
  name?: string;
  /** Timestamp (ms) of the most recent session change, used for the one-shot login auto-recovery. */
  getSessionChangedAt?: () => number | null;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions so one bad component cannot unmount the whole
 * tree (a blank screen). Recovery, in order:
 *  1. stale-deploy chunk failures trigger a single guarded hard reload;
 *  2. an error within 5s of a login/logout is retried once automatically;
 *  3. otherwise a friendly card with Reload / Try again, which also clears itself
 *     when the route or the signed-in user changes.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name ?? 'app'}]`, error, info.componentStack);
    if (isChunkLoadError(error) && reloadOnceForChunkError()) return;
    if (shouldAutoRecoverLogin({ now: Date.now(), sessionChangedAt: this.props.getSessionChangedAt?.() ?? null })) {
      console.warn(`[ErrorBoundary:${this.props.name ?? 'app'}] error right after a session change; retrying once`);
      this.reset();
    }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && resetKeysChanged(prev.resetKeys, this.props.resetKeys)) this.reset();
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const section = this.props.variant === 'section';
    return (
      <div
        role="alert"
        className={section ? 'flex w-full justify-center py-8' : 'flex min-h-[100dvh] w-full items-center justify-center bg-base px-4 text-text-primary'}
      >
        <div className="glass w-full max-w-md rounded-2xl border border-border bg-panel p-6 text-center shadow-panel">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-danger/15 text-danger">
            <AlertTriangle size={22} aria-hidden />
          </div>
          <h2 className="text-lg font-bold">Something went wrong</h2>
          <p className="mt-1 text-sm text-text-secondary">
            {isChunkLoadError(error)
              ? 'A new version of the app is available. Reload to get it.'
              : 'This part of the page failed to load. You can try again or reload.'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <RefreshCw size={14} aria-hidden /> Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * Module-level on purpose: the section boundary inside HubShell mounts *after* a login has
 * already happened, so a per-instance ref would never see the change. The always-mounted app-level
 * boundary records it during render, and every boundary reads the same timestamp.
 */
const sessionTrack: { userId: string | null | undefined; at: number | null } = { userId: undefined, at: null };
function noteSessionUser(userId: string | null): number | null {
  if (sessionTrack.userId === undefined) sessionTrack.userId = userId;
  else if (sessionTrack.userId !== userId) {
    sessionTrack.userId = userId;
    sessionTrack.at = Date.now();
  }
  return sessionTrack.at;
}

/** ErrorBoundary wired to the router + session: resets on navigation / login / logout and knows when the session last changed. */
export function RouteErrorBoundary({ children, variant = 'app', name }: { children: ReactNode; variant?: Variant; name?: string }) {
  const { pathname } = useLocation();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  // Written during render on purpose: an error thrown in the very render that follows a
  // session change must already see the new timestamp (an effect would run too late).
  noteSessionUser(userId);
  return (
    <ErrorBoundary variant={variant} name={name} resetKeys={[pathname, userId]} getSessionChangedAt={() => sessionTrack.at}>
      {children}
    </ErrorBoundary>
  );
}
