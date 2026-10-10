import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, CornerDownRight, Loader2, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { hubApi, hubPath, timeAgo, type HubComment } from '../../lib/hub';
import { cx } from '../../lib/format';
import { useInfinite } from '../../hooks/useInfinite';
import { useToast } from '../../context/ToastContext';
import Skeleton from '../Skeleton';
import Markdown from './Markdown';
import UserLink, { AuthorAvatar } from './UserLink';
import VoteColumn, { useVote } from './VoteColumn';

const BODY_MAX = 5000;
/** Deeper replies collapse into a "Continue this thread" link. */
export const MAX_DEPTH = 5;

type Sort = 'best' | 'new' | 'top';

export function CommentComposer({
  initial = '',
  placeholder,
  submitLabel,
  autoFocus,
  onSubmit,
  onCancel,
  onFocus,
}: {
  initial?: string;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  onFocus?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onSubmit(body);
      setText('');
    } catch {
      /* caller shows the toast; keep the draft */
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={text}
        autoFocus={autoFocus}
        onFocus={onFocus}
        onChange={(e) => setText(e.target.value.slice(0, BODY_MAX))}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void submit(e as unknown as FormEvent);
        }}
        rows={3}
        aria-label={placeholder}
        placeholder={placeholder}
        className="w-full resize-y rounded-xl border border-border bg-base/70 px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-text-muted">Markdown supported · {text.length}/{BODY_MAX}</span>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="tap rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-hover">
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="tap inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy && <Loader2 size={13} className="animate-spin" />} {submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

interface ItemProps {
  c: HubComment;
  depth: number;
  token: string | null;
  postId: string;
  requireAuth: () => boolean;
  collapsed: boolean;
  hiddenCount: number;
  onToggle: () => void;
  replying: boolean;
  editing: boolean;
  onReply: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onSubmitReply: (body: string) => Promise<void>;
  onSubmitEdit: (body: string) => Promise<void>;
  onDelete: () => void;
  continueHref: string | null;
}

function CommentItem(p: ItemProps) {
  const { c, depth } = p;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const vote = useVote(
    { score: c.score, myVote: c.myVote },
    (v) => (p.token ? hubApi.voteComment(p.token, c.id, v) : Promise.reject(new Error('Sign in to vote.'))),
    p.requireAuth
  );
  const gone = c.deleted;
  // A pending "Confirm delete" must not linger forever (touch screens never blur the button).
  useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);
  const btn = 'tap inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-text-secondary hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  return (
    <li
      id={`comment-${c.id}`}
      className={cx('animate-fade-in', depth > 0 && 'border-l border-border/70 pl-2 sm:pl-3')}
      style={depth > 0 ? { marginLeft: `${depth * 12}px` } : undefined}
    >
      <div className="py-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          <button
            type="button"
            onClick={p.onToggle}
            aria-expanded={!p.collapsed}
            aria-label={p.collapsed ? 'Expand comment' : 'Collapse comment'}
            className="hit inline-flex items-center justify-center rounded p-1 hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {p.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          {gone ? <span>[deleted]</span> : <AuthorAvatar author={c.author} size={20} />}
          {!gone && <UserLink author={c.author} className="max-w-[10rem] text-xs" />}
          <span aria-hidden>·</span>
          <time dateTime={c.createdAt}>{timeAgo(c.createdAt)}</time>
          {c.editedAt && !gone && <span title={c.editedAt}>(edited)</span>}
          {p.collapsed && p.hiddenCount > 0 && <span>· {p.hiddenCount} more {p.hiddenCount === 1 ? 'reply' : 'replies'}</span>}
        </div>

        {!p.collapsed && (
          <div className="pl-5">
            {p.editing ? (
              <div className="mt-2">
                <CommentComposer initial={c.body} placeholder="Edit your comment" submitLabel="Save" autoFocus onSubmit={p.onSubmitEdit} onCancel={p.onCancel} />
              </div>
            ) : gone ? (
              <p className="mt-1 text-sm italic text-text-muted">[deleted]</p>
            ) : (
              <Markdown text={c.body} className="mt-1" />
            )}

            {!gone && !p.editing && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <VoteColumn horizontal size="sm" score={vote.score} myVote={vote.myVote} onUp={() => vote.cast(1)} onDown={() => vote.cast(-1)} />
                <button type="button" onClick={p.onReply} className={btn}>
                  <MessageSquare size={13} /> Reply
                </button>
                {c.mine && (
                  <>
                    <button type="button" onClick={p.onEdit} className={btn}>
                      <Pencil size={13} /> Edit
                    </button>
                    {confirmDelete ? (
                      <button type="button" onClick={p.onDelete} onBlur={() => setConfirmDelete(false)} className={cx(btn, 'text-danger')}>
                        <Trash2 size={13} /> Confirm delete
                      </button>
                    ) : (
                      <button type="button" onClick={() => setConfirmDelete(true)} className={btn}>
                        <Trash2 size={13} /> Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {p.replying && (
              <div className="mt-2">
                <CommentComposer placeholder={`Reply to u/${c.author.username}`} submitLabel="Reply" autoFocus onSubmit={p.onSubmitReply} onCancel={p.onCancel} />
              </div>
            )}
            {p.continueHref && (
              <Link to={p.continueHref} className="tap mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                <CornerDownRight size={13} /> Continue this thread
              </Link>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** Subtree of `rootId` (including the root), with depths rebased to 0. */
function subtree(list: HubComment[], rootId: string | null): { c: HubComment; depth: number }[] {
  if (!rootId) return list.map((c) => ({ c, depth: c.depth }));
  const i = list.findIndex((c) => c.id === rootId);
  if (i < 0) return list.map((c) => ({ c, depth: c.depth }));
  const base = list[i].depth;
  const out = [{ c: list[i], depth: 0 }];
  for (let j = i + 1; j < list.length && list[j].depth > base; j++) out.push({ c: list[j], depth: list[j].depth - base });
  return out;
}

export default function Comments({
  postId,
  token,
  requireAuth,
  onCountChange,
  rootId,
}: {
  postId: string;
  token: string | null;
  requireAuth: () => boolean;
  onCountChange: (delta: number) => void;
  /** When set, shows only this comment's thread (the "continue this thread" view). */
  rootId?: string | null;
}) {
  const { showToast } = useToast();
  const [sort, setSort] = useState<Sort>('best');
  const [nonce, setNonce] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const feed = useInfinite<HubComment>(
    (cursor) => hubApi.listComments(token, postId, sort, cursor),
    `${postId}|${sort}|${token ? 1 : 0}|${nonce}`,
    true,
    (m) => showToast(m, 'error')
  );
  const { items, setItems } = feed;

  // Deep link (#comment-<id>, e.g. from a profile's Comments tab): scroll to it once it has loaded.
  const { hash } = useLocation();
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!hash.startsWith('#comment-') || feed.loading || scrolledTo.current === hash) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    scrolledTo.current = hash;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('bg-accent/10', 'rounded-lg');
    const t = window.setTimeout(() => el.classList.remove('bg-accent/10'), 2500);
    return () => window.clearTimeout(t);
  }, [hash, feed.loading, items.length]);

  const rows = useMemo(() => {
    const all = subtree(items, rootId ?? null);
    const out: { c: HubComment; depth: number; hidden: number; cont: boolean }[] = [];
    let skipDepth: number | null = null;
    for (let i = 0; i < all.length; i++) {
      const { c, depth } = all[i];
      if (skipDepth !== null) {
        if (depth > skipDepth) continue;
        skipDepth = null;
      }
      let hidden = 0;
      for (let j = i + 1; j < all.length && all[j].depth > depth; j++) hidden++;
      if (depth > MAX_DEPTH) continue;
      const cont = depth === MAX_DEPTH && hidden > 0;
      out.push({ c, depth, hidden, cont });
      if (collapsed.has(c.id)) skipDepth = depth;
    }
    return out;
  }, [items, rootId, collapsed]);

  function patch(id: string, f: (c: HubComment) => HubComment) {
    setItems((prev) => prev.map((c) => (c.id === id ? f(c) : c)));
  }

  async function submitNew(body: string, parent: HubComment | null) {
    if (!requireAuth() || !token) throw new Error('auth');
    try {
      const created = await hubApi.addComment(token, postId, body, parent?.id);
      onCountChange(1);
      setReplyTo(null);
      if (!created) {
        setNonce((n) => n + 1);
        return;
      }
      const comment: HubComment = { ...created, mine: true, parentId: parent?.id ?? created.parentId, depth: parent ? parent.depth + 1 : 0 };
      setItems((prev) => {
        if (!parent) return [comment, ...prev];
        const i = prev.findIndex((c) => c.id === parent.id);
        if (i < 0) return [comment, ...prev];
        let end = i + 1;
        while (end < prev.length && prev[end].depth > parent.depth) end++;
        return [...prev.slice(0, end), comment, ...prev.slice(end)];
      });
      if (parent) setCollapsed((s) => (s.has(parent.id) ? new Set([...s].filter((x) => x !== parent.id)) : s));
    } catch (err) {
      showToast(err instanceof Error && err.message !== 'auth' ? err.message : 'Could not post comment.', 'error');
      throw err;
    }
  }

  async function submitEdit(c: HubComment, body: string) {
    if (!token) return;
    try {
      await hubApi.editComment(token, c.id, body);
      patch(c.id, (x) => ({ ...x, body, editedAt: new Date().toISOString() }));
      setEditing(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not edit comment.', 'error');
      throw err;
    }
  }

  async function remove(c: HubComment) {
    if (!token) return;
    try {
      await hubApi.deleteComment(token, c.id);
      patch(c.id, (x) => ({ ...x, deleted: true, body: '' }));
      showToast('Comment deleted', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete comment.', 'error');
    }
  }

  const tab = 'tap rounded-lg px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  return (
    <section aria-label="Comments" className="space-y-4">
      {!rootId && (
        <div className="glass rounded-2xl p-3">
          <CommentComposer
            placeholder={token ? 'Add a comment' : 'Sign in to comment'}
            submitLabel="Comment"
            onFocus={() => {
              if (!token) requireAuth();
            }}
            onSubmit={(b) => submitNew(b, null)}
          />
        </div>
      )}

      <div className="glass rounded-2xl p-3 sm:p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold">Comments</h2>
          {rootId && (
            <Link to={hubPath.post(postId)} className="tap inline-flex items-center text-xs font-semibold text-accent hover:underline">
              Back to all comments
            </Link>
          )}
          <div role="tablist" aria-label="Sort comments" className="ml-auto flex gap-1">
            {(['best', 'new', 'top'] as Sort[]).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={sort === s}
                onClick={() => setSort(s)}
                className={cx(tab, sort === s ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-hover')}
              >
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {rows.length > 0 && (
          <ul className="space-y-0.5">
            {rows.map(({ c, depth, hidden, cont }) => (
              <CommentItem
                key={c.id}
                c={c}
                depth={depth}
                token={token}
                postId={postId}
                requireAuth={requireAuth}
                collapsed={collapsed.has(c.id)}
                hiddenCount={hidden}
                onToggle={() =>
                  setCollapsed((s) => {
                    const n = new Set(s);
                    if (n.has(c.id)) n.delete(c.id);
                    else n.add(c.id);
                    return n;
                  })
                }
                replying={replyTo === c.id}
                editing={editing === c.id}
                onReply={() => {
                  if (!requireAuth()) return;
                  setEditing(null);
                  setReplyTo(c.id);
                }}
                onEdit={() => {
                  setReplyTo(null);
                  setEditing(c.id);
                }}
                onCancel={() => {
                  setReplyTo(null);
                  setEditing(null);
                }}
                onSubmitReply={(b) => submitNew(b, c)}
                onSubmitEdit={(b) => submitEdit(c, b)}
                onDelete={() => void remove(c)}
                continueHref={cont ? `${hubPath.post(postId)}?root=${encodeURIComponent(c.id)}` : null}
              />
            ))}
          </ul>
        )}

        {feed.loading && (
          <div role="status" aria-busy="true" aria-label="Loading comments" className="space-y-3 py-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-2">
                <Skeleton className="h-5 w-5 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-2.5 w-32" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        )}
        {feed.failed && (
          <p role="alert" className="py-2 text-sm text-danger">
            Couldn't load comments.{' '}
            <button type="button" className="tap font-semibold underline" onClick={feed.retry}>
              Retry
            </button>
          </p>
        )}
        {!feed.loading && !feed.failed && items.length === 0 && (
          <p className="py-6 text-center text-sm text-text-muted">No comments yet. Start the conversation.</p>
        )}
        <div ref={feed.sentinel} className="h-1" />
      </div>
    </section>
  );
}
