/**
 * Pure reconnect / retry logic shared by the media signaling socket, joins and
 * other transient-failure retries. No timers or DOM here except via injected deps.
 */

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** 0..1 fraction of the delay randomised (full-jitter style, never below half the delay). */
  jitter?: number;
}

/** Delay before retry number `attempt` (1-based): base * 2^(attempt-1), capped, with jitter. */
export function backoffDelayMs(attempt: number, opts: BackoffOptions = {}, rand: () => number = Math.random): number {
  const base = opts.baseMs ?? 1000;
  const max = opts.maxMs ?? 15_000;
  const jitter = Math.min(1, Math.max(0, opts.jitter ?? 0.3));
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  // Spread within [exp*(1-jitter), exp].
  return Math.round(exp * (1 - jitter * rand()));
}

export type ReconnectPhase = 'idle' | 'waiting' | 'attempting' | 'failed';

export interface ReconnectSnapshot {
  phase: ReconnectPhase;
  /** Attempts made so far in this run (1-based while attempting). */
  attempt: number;
  maxAttempts: number;
  /** Epoch ms of the next attempt while `waiting`. */
  nextAttemptAt: number | null;
}

export interface ReconnectorDeps {
  /** Resolve on success. Reject with an error; set `fatal: true` on it (or return via isFatal) to stop retrying. */
  attempt: (attempt: number) => Promise<void>;
  onChange?: (snapshot: ReconnectSnapshot) => void;
  isFatal?: (err: unknown) => boolean;
  maxAttempts?: number;
  backoff?: BackoffOptions;
  now?: () => number;
  rand?: () => number;
  sleep?: (ms: number, signal: { cancelled: boolean }) => Promise<void>;
}

/** Retry runner with exponential backoff + jitter; `failed` after maxAttempts or a fatal error. */
export function createReconnector(deps: ReconnectorDeps) {
  const maxAttempts = deps.maxAttempts ?? 6;
  const now = deps.now ?? (() => Date.now());
  const rand = deps.rand ?? Math.random;
  const sleep =
    deps.sleep ??
    ((ms: number, token: { cancelled: boolean }) =>
      new Promise<void>((resolve) => {
        const id = setTimeout(resolve, ms);
        // Cancellation is checked by the loop after waking; no early wake needed.
        void token;
        void id;
      }));
  let snap: ReconnectSnapshot = { phase: 'idle', attempt: 0, maxAttempts, nextAttemptAt: null };
  let token: { cancelled: boolean } = { cancelled: false };
  let running = false;

  function set(next: Partial<ReconnectSnapshot>) {
    snap = { ...snap, ...next };
    deps.onChange?.(snap);
  }

  async function run(): Promise<boolean> {
    const mine = token;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (mine.cancelled) return false;
      const delay = backoffDelayMs(attempt, deps.backoff, rand);
      set({ phase: 'waiting', attempt, nextAttemptAt: now() + delay });
      await sleep(delay, mine);
      if (mine.cancelled) return false;
      set({ phase: 'attempting', nextAttemptAt: null });
      try {
        await deps.attempt(attempt);
        if (mine.cancelled) return false;
        set({ phase: 'idle', attempt: 0, nextAttemptAt: null });
        return true;
      } catch (err) {
        if (mine.cancelled) return false;
        if (deps.isFatal?.(err) || (err as { fatal?: boolean } | null)?.fatal) {
          set({ phase: 'failed', nextAttemptAt: null });
          return false;
        }
      }
    }
    if (!mine.cancelled) set({ phase: 'failed', nextAttemptAt: null });
    return false;
  }

  return {
    /** Begin (or restart) a run. Resolves true when an attempt succeeded. */
    start(): Promise<boolean> {
      token.cancelled = true;
      token = { cancelled: false };
      running = true;
      set({ phase: 'waiting', attempt: 0, nextAttemptAt: null });
      return run().finally(() => {
        running = false;
      });
    },
    cancel() {
      token.cancelled = true;
      set({ phase: 'idle', attempt: 0, nextAttemptAt: null });
    },
    get running() {
      return running;
    },
    get snapshot() {
      return snap;
    },
  };
}
