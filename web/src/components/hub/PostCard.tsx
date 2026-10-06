import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, ExternalLink, Flag, MessageSquare, MoreHorizontal, Pin, Share2, Trash2, X } from 'lucide-react';
import { hubApi, hubPath, linkHost, timeAgo, type HubPost } from '../../lib/hub';
import { cx } from '../../lib/format';
import { markdownToPlain } from '../../lib/markdown';
import { copyText } from '../../lib/clipboard';
import { useToast } from '../../context/ToastContext';
import PostBadges from './PostBadges';
import Markdown from './Markdown';
import VoteColumn, { useVote } from './VoteColumn';
import UserLink, { AuthorAvatar } from './UserLink';

export type FeedView = 'card' | 'compact';

interface Props {
  post: HubPost;
  token: string | null;
  requireAuth: () => boolean;
  onDeleted?: (id: string) => void;
  view?: FeedView;
  /** Thread page: full body, lightbox, no link to self. */
  detail?: boolean;
}

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        autoFocus
        onClick={onClose}
        aria-label="Close preview"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X size={20} />
      </button>
      <img src={src} alt={alt} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

export default function PostCard({ post: initial, token, requireAuth, onDeleted, view = 'card', detail = false }: Props) {
  const { showToast } = useToast();
  const [post, setPost] = useState(initial);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [imgFailed, setImgFailed] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);

  useEffect(() => setPost((p) => (p.commentCount === initial.commentCount ? p : { ...p, commentCount: initial.commentCount })), [initial.commentCount]);

  const vote = useVote(
    { score: post.score, myVote: post.myVote },
    (v) => (token ? hubApi.votePost(token, post.id, v) : Promise.reject(new Error('Sign in to vote.'))),
    requireAuth
  );

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenu(false);
        setConfirmDelete(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  async function toggleSave() {
    if (!requireAuth() || !token || savingRef.current) return;
    savingRef.current = true;
    const next = !post.saved;
    setPost((p) => ({ ...p, saved: next }));
    try {
      await hubApi.savePost(token, post.id, next);
      showToast(next ? 'Saved' : 'Removed from saved', 'success');
    } catch (err) {
      setPost((p) => ({ ...p, saved: !next }));
      showToast(err instanceof Error ? err.message : 'Could not update saved posts.', 'error');
    } finally {
      savingRef.current = false;
    }
  }

  async function share() {
    const ok = await copyText(`${window.location.origin}${hubPath.post(post.id)}`);
    showToast(ok ? 'Link copied' : 'Could not copy link', ok ? 'success' : 'error');
  }

  async function del() {
    if (!token) return;
    try {
      await hubApi.deletePost(token, post.id);
      showToast('Post deleted', 'success');
      onDeleted?.(post.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete post.', 'error');
    }
    setMenu(false);
    setConfirmDelete(false);
  }

  async function pin() {
    if (!token) return;
    setMenu(false);
    try {
      await hubApi.pinPost(token, post.id);
      setPost((p) => ({ ...p, pinned: !p.pinned }));
      showToast('Pin updated', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not pin post.', 'error');
    }
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

  const host = linkHost(post.linkUrl);
  const compact = view === 'compact' && !detail;
  const itemCls = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover focus-visible:bg-hover focus-visible:outline-none';
  const actionCls =
    'inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  const title = detail ? (
    <h1 className="break-words text-lg font-bold leading-snug sm:text-xl">{post.title}</h1>
  ) : (
    <h3 className={cx('break-words font-bold leading-snug', compact ? 'text-sm' : 'text-base')}>
      <Link to={hubPath.post(post.id)} className="hover:text-accent focus-visible:outline-none focus-visible:underline">
        {post.title || 'Untitled'}
      </Link>
    </h3>
  );

  const image =
    post.type === 'image' && post.imageUrl ? (
      imgFailed ? (
        <div className="flex aspect-video items-center justify-center rounded-xl bg-base text-sm text-text-muted">Image unavailable</div>
      ) : detail ? (
        <button type="button" onClick={() => setLightbox(true)} aria-label="Open image" className="block w-full cursor-zoom-in rounded-xl bg-base">
          <img
            src={post.imageUrl}
            alt={post.title}
            onError={() => setImgFailed(true)}
            className="mx-auto max-h-[75vh] w-full rounded-xl object-contain"
          />
        </button>
      ) : (
        <Link to={hubPath.post(post.id)} aria-label={`Open ${post.title}`} className="block rounded-xl bg-base">
          <img
            src={post.imageUrl}
            alt={post.title}
            loading="lazy"
            draggable={false}
            onError={() => setImgFailed(true)}
            className="mx-auto max-h-[70vh] w-full rounded-xl object-contain"
          />
        </Link>
      )
    ) : null;

  const linkCard =
    post.type === 'link' && host && post.linkUrl ? (
      <a
        href={post.linkUrl}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        className="flex items-center gap-3 rounded-xl border border-border bg-base/60 px-3 py-2.5 text-sm transition-colors hover:border-accent/50"
      >
        <ExternalLink size={18} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{host}</span>
          <span className="block text-xs text-text-muted">Opens in a new tab</span>
        </span>
      </a>
    ) : null;

  const body = detail ? (
    post.body ? <Markdown text={post.body} /> : null
  ) : !compact && post.body ? (
    <p className="line-clamp-3 break-words text-sm text-text-secondary">{markdownToPlain(post.body, 300)}</p>
  ) : null;

  const thumb = compact && post.type === 'image' && post.imageUrl && !imgFailed ? post.imageUrl : null;

  return (
    <article id={`post-${post.id}`} className="glass glass-glow flex gap-2 overflow-hidden rounded-2xl p-2.5 sm:gap-3 sm:p-3">
      <div className="shrink-0 pt-0.5">
        <VoteColumn score={vote.score} myVote={vote.myVote} onUp={() => vote.cast(1)} onDown={() => vote.cast(-1)} size={compact ? 'sm' : 'md'} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          <AuthorAvatar author={post.author} size={20} />
          {post.community && (
            <Link to={hubPath.community(post.community.slug)} className="font-bold text-text-primary hover:text-accent hover:underline">
              c/{post.community.slug}
            </Link>
          )}
          <UserLink author={post.author} className="max-w-[10rem] text-xs" />
          <span aria-hidden>·</span>
          <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
          {post.pinned && (
            <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-1.5 py-0.5 font-semibold text-success">
              <Pin size={11} /> Pinned
            </span>
          )}
          {post.flair && <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-semibold text-accent">{post.flair}</span>}
        </div>

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            {title}
            {!compact && <PostBadges post={post} />}
            {body}
          </div>
          {thumb && (
            <Link to={hubPath.post(post.id)} tabIndex={-1} aria-hidden className="shrink-0">
              <img src={thumb} alt="" loading="lazy" onError={() => setImgFailed(true)} className="h-16 w-16 rounded-lg bg-base object-cover sm:h-20 sm:w-20" />
            </Link>
          )}
        </div>
        {!compact && image}
        {!compact && linkCard}
        {compact && post.type === 'link' && host && <p className="truncate text-xs text-text-muted">{host}</p>}

        <div className="-ml-1.5 flex flex-wrap items-center gap-0.5">
          <Link to={hubPath.post(post.id)} className={actionCls} aria-label={`${post.commentCount} comments`}>
            <MessageSquare size={15} />
            <span className="tabular-nums">{post.commentCount}</span>
            <span className="hidden sm:inline">{post.commentCount === 1 ? 'comment' : 'comments'}</span>
          </Link>
          <button type="button" onClick={() => void toggleSave()} aria-pressed={post.saved} className={cx(actionCls, post.saved && 'text-accent')}>
            <Bookmark size={15} className={cx(post.saved && 'fill-accent')} />
            <span className="hidden sm:inline">{post.saved ? 'Saved' : 'Save'}</span>
          </button>
          <button type="button" onClick={() => void share()} className={actionCls}>
            <Share2 size={15} />
            <span className="hidden sm:inline">Share</span>
          </button>
          <div className="relative" ref={menuRef}>
            <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Post options" aria-haspopup="menu" aria-expanded={menu} className={actionCls}>
              <MoreHorizontal size={16} />
            </button>
            {menu && (
              <div role="menu" className="absolute left-0 z-20 mt-1 w-44 animate-pop-in rounded-lg border border-border bg-panel py-1 shadow-2xl">
                {post.mine ? (
                  <>
                    <button role="menuitem" type="button" onClick={() => void pin()} className={itemCls}>
                      <Pin size={14} /> {post.pinned ? 'Unpin' : 'Pin to community'}
                    </button>
                    {confirmDelete ? (
                      <button role="menuitem" type="button" onClick={() => void del()} className={cx(itemCls, 'font-semibold text-danger')}>
                        <Trash2 size={14} /> Confirm delete
                      </button>
                    ) : (
                      <button role="menuitem" type="button" onClick={() => setConfirmDelete(true)} className={cx(itemCls, 'text-danger')}>
                        <Trash2 size={14} /> Delete post
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    role="menuitem"
                    type="button"
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

        {reporting && (
          <div className="rounded-xl border border-border bg-base/60 p-3">
            <label htmlFor={`rp-${post.id}`} className="mb-1 block text-xs text-text-secondary">
              Why are you reporting this post?
            </label>
            <textarea
              id={`rp-${post.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 300))}
              rows={2}
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setReporting(false)} className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-hover">
                Cancel
              </button>
              <button type="button" onClick={() => void sendReport()} className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white">
                Report
              </button>
            </div>
          </div>
        )}
      </div>
      {lightbox && post.imageUrl && <Lightbox src={post.imageUrl} alt={post.title} onClose={() => setLightbox(false)} />}
    </article>
  );
}
