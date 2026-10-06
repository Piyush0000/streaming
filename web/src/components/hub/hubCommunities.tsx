import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { hubApi, type HubCommunity } from '../../lib/hub';
import { useHubAuth } from '../../hooks/useHubAuth';
import { useToast } from '../../context/ToastContext';

interface Ctx {
  communities: HubCommunity[];
  loading: boolean;
  failed: boolean;
  reload: () => void;
  /** Optimistic join/leave with rollback. Resolves to the new joined state (or the old one on failure). */
  toggleJoin: (slug: string, currentJoined?: boolean) => Promise<boolean | null>;
  add: (c: HubCommunity) => void;
}

const HubCommunitiesContext = createContext<Ctx | null>(null);

export function HubCommunitiesProvider({ children }: { children: ReactNode }) {
  const { token, initializing, requireAuth } = useHubAuth();
  const { showToast } = useToast();
  const [communities, setCommunities] = useState<HubCommunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const busy = useRef(new Set<string>());
  const listRef = useRef(communities);
  listRef.current = communities;

  useEffect(() => {
    if (initializing) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    hubApi
      .listCommunities(token)
      .then((list) => !cancelled && setCommunities(list.filter((c) => c.slug)))
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token, initializing, nonce]);

  const toggleJoin = useCallback(
    async (slug: string, currentJoined?: boolean) => {
      if (!requireAuth() || !token || busy.current.has(slug)) return null;
      const cur = listRef.current.find((c) => c.slug === slug);
      const was = currentJoined ?? cur?.joined ?? false;
      const next = !was;
      busy.current.add(slug);
      const patch = (joined: boolean, delta: number) =>
        setCommunities((prev) => prev.map((c) => (c.slug === slug ? { ...c, joined, memberCount: Math.max(0, c.memberCount + delta) } : c)));
      patch(next, next ? 1 : -1);
      try {
        await hubApi.join(token, slug, next);
        return next;
      } catch (err) {
        patch(was, next ? -1 : 1);
        showToast(err instanceof Error ? err.message : 'Could not update membership.', 'error');
        return was;
      } finally {
        busy.current.delete(slug);
      }
    },
    [token, requireAuth, showToast]
  );

  const add = useCallback((c: HubCommunity) => setCommunities((prev) => [c, ...prev.filter((x) => x.slug !== c.slug)]), []);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo(() => ({ communities, loading, failed, reload, toggleJoin, add }), [communities, loading, failed, reload, toggleJoin, add]);
  return <HubCommunitiesContext.Provider value={value}>{children}</HubCommunitiesContext.Provider>;
}

export function useHubCommunities(): Ctx {
  const ctx = useContext(HubCommunitiesContext);
  if (!ctx) throw new Error('useHubCommunities must be used inside HubShell');
  return ctx;
}
