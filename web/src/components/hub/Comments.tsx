import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { hubApi, HubComment } from '../../lib/hub';
import { relativeTime } from '../../lib/format';
import Avatar from '../Avatar';
import { useUserCard } from '../UserCard';
import { useProfiles } from '../../hooks/useProfiles';
import { useToast } from '../../context/ToastContext';

interface Props {
  postId: string;
  token: string | null;
  requireAuth: () => boolean;
  onCountChange: (delta: number) => void;
}

export default function Comments({ postId, token, requireAuth, onCountChange }: Props) {
  const { showToast } = useToast();
  const { openUserCard } = useUserCard();
  const [comments, setComments] = useState<HubComment[]>([]);
  const authorIds = useMemo(() => comments.map((c) => c.author.id), [comments]);
  const profiles = useProfiles(authorIds);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(
    async (c: string | null) => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await hubApi.listComments(token, postId, c);
        setComments((prev) => (c ? [...prev, ...res.comments] : res.comments));
        setCursor(res.nextCursor);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [postId, token]
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    if (!requireAuth() || !token) return;
    setSending(true);
    try {
      const { comment } = await hubApi.addComment(token, postId, body);
      setComments((prev) => [...prev, comment]);
      onCountChange(1);
      setText('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not post comment.', 'error');
    } finally {
      setSending(false);
    }
  }

  async function remove(c: HubComment) {
    if (!token) return;
    try {
      await hubApi.deleteComment(token, c.id);
      setComments((prev) => prev.filter((x) => x.id !== c.id));
      onCountChange(-1);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete comment.', 'error');
    }
  }

  return (
    <div className="border-t border-border px-4 py-3">
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <button
              type="button"
              onClick={() => token && openUserCard(c.author.id, c.author.username)}
              className="mt-0.5 shrink-0 self-start rounded-full"
              aria-label={`View ${c.author.username}'s profile`}
            >
              <Avatar name={c.author.username} src={profiles.get(c.author.id)?.avatarUrl} preset={profiles.get(c.author.id)?.avatarPreset} size={28} />
            </button>
            <div className="min-w-0 flex-1 text-sm">
              <span className="font-semibold">{profiles.get(c.author.id)?.displayName || c.author.username}</span>{' '}
              <span className="whitespace-pre-wrap break-words text-text-secondary">{c.body}</span>
              <div className="text-[11px] text-text-muted">{relativeTime(c.createdAt)}</div>
            </div>
            {c.mine && (
              <button
                onClick={() => void remove(c)}
                aria-label="Delete comment"
                className="self-start rounded p-1 text-text-muted hover:bg-hover hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {loading && <p className="py-2 text-xs text-text-muted">Loading comments…</p>}
      {failed && (
        <p className="py-2 text-xs text-danger">
          Couldn't load comments.{' '}
          <button className="underline" onClick={() => void load(cursor)}>
            Retry
          </button>
        </p>
      )}
      {!loading && !failed && comments.length === 0 && (
        <p className="py-2 text-xs text-text-muted">No comments yet. Start the conversation.</p>
      )}
      {cursor && !loading && !failed && (
        <button className="py-1 text-xs font-semibold text-accent" onClick={() => void load(cursor)}>
          Load more comments
        </button>
      )}
      <form onSubmit={submit} className="mt-3 flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 500))}
          onFocus={() => {
            if (!token) requireAuth();
          }}
          placeholder={token ? 'Add a comment…' : 'Sign in to comment'}
          maxLength={500}
          className="min-w-0 flex-1 rounded-lg border border-border bg-base px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          aria-label="Post comment"
          className="rounded-lg bg-accent p-2 text-white disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
