import { createContext, createElement, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext';
import { blockUser, fetchBlocks, unblockUser, type BlockedUser } from '../lib/profiles';

export interface BlocksValue {
  /** True when the signed-in user has blocked `userId`. Always false while signed out / not yet loaded. */
  isBlocked: (userId: string) => boolean;
  blocks: BlockedUser[];
  loading: boolean;
  /** Last load error (the previously loaded list is kept). */
  error: string | null;
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const EMPTY: BlocksValue = {
  isBlocked: () => false,
  blocks: [],
  loading: false,
  error: null,
  block: async () => undefined,
  unblock: async () => undefined,
  refresh: async () => undefined,
};

const BlocksContext = createContext<BlocksValue>(EMPTY);

/**
 * Loads the signed-in user's block list once per session and keeps it in sync
 * with block/unblock calls. Chat history and live messages are already filtered
 * server-side; this list additionally drives the client-side safety-net filter
 * (MessageList) and lets voice code mute blocked people.
 */
export function BlocksProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const token = session?.accessToken ?? null;
  const userId = session?.user.id ?? null;
  const [blocks, setBlocks] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setBlocks(await fetchBlocks(token));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load blocked users.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    setBlocks([]);
    setError(null);
    if (token) void refresh();
    // Reload on user change; token refreshes alone should not reset the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const ids = useMemo(() => new Set(blocks.map((b) => b.id)), [blocks]);

  const block = useCallback(
    async (target: string) => {
      if (!token) throw new Error('You are signed out.');
      await blockUser(token, target);
      await refresh();
    },
    [token, refresh]
  );

  const unblock = useCallback(
    async (target: string) => {
      if (!token) throw new Error('You are signed out.');
      await unblockUser(token, target);
      setBlocks((prev) => prev.filter((b) => b.id !== target));
    },
    [token]
  );

  const value = useMemo<BlocksValue>(
    () => ({ isBlocked: (id: string) => ids.has(id), blocks, loading, error, block, unblock, refresh }),
    [ids, blocks, loading, error, block, unblock, refresh]
  );

  return createElement(BlocksContext.Provider, { value }, children);
}

export function useBlocks(): BlocksValue {
  return useContext(BlocksContext);
}
