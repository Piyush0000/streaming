import { useEffect, useMemo, useRef, useState } from 'react';
import { Flag, Heart, MessageCircle, MoreHorizontal, Share2, Trash2 } from 'lucide-react';
import { hubApi, HubPost } from '../../lib/hub';
import { cx, relativeTime } from '../../lib/format';
import Avatar from '../Avatar';
import { useUserCard } from '../UserCard';
import { useProfiles } from '../../hooks/useProfiles';
import { copyText } from '../../lib/clipboard';
import { useToast } from '../../context/ToastContext';
import PostBadges from './PostBadges';
import Comments from './Comments';

interface Props {
  post: HubPost;
  token: string | null;
  requireAuth: () => boolean;
  onDeleted: (id: string) => void;
}

export default function PostCard({ post: initial, token, requireAuth, onDeleted }: Props) {
  const { showToast } = useToast();
  const { openUserCard } = useUserCard();
  const [post, setPost] = useState(initial);
  const authorIds = useMemo(() => [initial.author.id], [initial.author.id]);
  const authorProfile = useProfiles(authorIds).get(initial.author.id);
  const authorName = authorProfile?.displayName || initial.author.username;
  const [pop, setPop] = useState(false);
  const [bump, setBump] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [imgFailed, setImgFailed] = useState(false);
  const busy = useRef(false);
  const lastTap = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenu(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  async function setLiked(next: boolean) {
    if (busy.current || post.likedByMe === next) return;
    if (!requireAuth() || !token) return;
    busy.current = true;
    const prev = post;
    setPost({ ...post, likedByMe: next, likeCount: Math.max(0, post.likeCount + (next ? 1 : -1)) });
    if (next) {
      setBump(true);
      window.setTimeout(() => setBump(false), 320);
    }
    try {
      const res = await hubApi.like(token, post.id, next);
      setPost((p) => ({ ...p, likedByMe: res.liked, likeCount: res.likeCount }));
    } catch (err) {
      setPost(prev);
      showToast(err instanceof Error ? err.message : 'Could not update like.', 'error');
    } finally {
      busy.current = false;
    }
  }

  function onImageTap() {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      if (!requireAuth()) return;
      setPop(true);
      window.setTimeout(() => setPop(false), 800);
      if (!post.likedByMe) void setLiked(true);
    } else {
      lastTap.current = now;
    }
  }

  async function share() {
    const ok = await copyText(`${window.location.origin}/elonixhub#post-${post.id}`);
    showToast(ok ? 'Link copied' : 'Could not copy link', ok ? 'success' : 'error');
  }

  async function del() {
    if (!token) return;
    try {
      await hubApi.deletePost(token, post.id);
      onDeleted(post.id);
      showToast('Post deleted', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete post.', 'error');
    }
    setMenu(false);
    setConfirmDelete(false);
  }

  async function sendReport() {
    if (!token) return;
    try {
      await hubApi.report(token, post.id, reason.trim() || 'inappropriate');
      showToast('Thanks, we will review this post.', 'success');
      setReporting(false);
      setReason('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send report.', 'error');
    }
  }

  const itemCls = 'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-hover';

  return (
    <article id={`post-${post.id}`} className="overflow-hidden rounded-2xl border border-border bg-panel">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => token && openUserCard(post.author.id, post.author.username)}
          className="shrink-0 rounded-full"
          aria-label={`View ${authorName}'s profile`}
        >
          <Avatar name={post.author.username} src={authorProfile?.avatarUrl} size={36} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{authorName}</div>
          <div className="text-xs text-text-muted">{relativeTime(post.createdAt)}</div>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenu((m) => !m)}
            aria-label="Post options"
            aria-haspopup="menu"
            aria-expanded={menu}
            className="rounded-lg p-2 text-text-secondary hover:bg-hover hover:text-text-primary"
          >
            <MoreHorizontal size={18} />
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-border bg-panel py-1 shadow-2xl">
              {post.mine ? (
                confirmDelete ? (
                  <button role="menuitem" onClick={() => void del()} className={cx(itemCls, 'font-semibold text-danger')}>
                    <Trash2 size={14} /> Confirm delete
                  </button>
                ) : (
                  <button role="menuitem" onClick={() => setConfirmDelete(true)} className={cx(itemCls, 'text-danger')}>
                    <Trash2 size={14} /> Delete post
                  </button>
                )
              ) : (
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    if (requireAuth()) setReporting(true);
                  }}
                  className={itemCls}
                >
                  <Flag size={14} /> Report post
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="relative select-none bg-base" onClick={onImageTap}>
        {imgFailed ? (
          <div className="flex aspect-video items-center justify-center text-sm text-text-muted">Image unavailable</div>
        ) : (
          <img
            src={post.imageUrl}
            alt={post.caption ? post.caption.slice(0, 120) : `Trade by ${post.author.username}`}
            loading="lazy"
            draggable={false}
            onError={() => setImgFailed(true)}
            className="max-h-[70vh] w-full object-contain"
          />
        )}
        {pop && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Heart className="animate-heart-pop h-24 w-24 fill-danger text-danger drop-shadow-lg" />
          </div>
        )}
      </div>

      <div className="space-y-2.5 px-4 py-3">
        <div className="-ml-2 flex items-center gap-1">
          <button
            onClick={() => void setLiked(!post.likedByMe)}
            aria-pressed={post.likedByMe}
            aria-label={post.likedByMe ? 'Unlike' : 'Like'}
            className="flex items-center gap-1.5 rounded-lg p-2 text-sm hover:bg-hover"
          >
            <Heart
              size={22}
              className={cx(bump && 'animate-heart-bump', post.likedByMe ? 'fill-danger text-danger' : 'text-text-secondary')}
            />
            <span className="tabular-nums">{post.likeCount}</span>
          </button>
          <button
            onClick={() => setShowComments((v) => !v)}
            aria-expanded={showComments}
            aria-label="Toggle comments"
            className={cx('flex items-center gap-1.5 rounded-lg p-2 text-sm hover:bg-hover', showComments ? 'text-accent' : 'text-text-secondary')}
          >
            <MessageCircle size={22} />
            <span className="tabular-nums">{post.commentCount}</span>
          </button>
          <button onClick={() => void share()} aria-label="Copy link" className="ml-auto rounded-lg p-2 text-text-secondary hover:bg-hover">
            <Share2 size={20} />
          </button>
        </div>
        <PostBadges post={post} />
        {post.caption && (
          <p className="whitespace-pre-wrap break-words text-sm">
            <span className="font-semibold">{authorName}</span>{' '}
            <span className="text-text-secondary">{post.caption}</span>
          </p>
        )}
      </div>

      {reporting && (
        <div className="border-t border-border px-4 py-3">
          <label className="mb-1 block text-xs text-text-secondary">Why are you reporting this post?</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 300))}
            rows={2}
            className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => setReporting(false)} className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-hover">
              Cancel
            </button>
            <button onClick={() => void sendReport()} className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white">
              Report
            </button>
          </div>
        </div>
      )}

      {showComments && (
        <Comments
          postId={post.id}
          token={token}
          requireAuth={requireAuth}
          onCountChange={(d) => setPost((p) => ({ ...p, commentCount: Math.max(0, p.commentCount + d) }))}
        />
      )}
    </article>
  );
}
