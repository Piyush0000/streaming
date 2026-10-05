import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocks } from '../hooks/useBlocks';
import { useProfiles, type Profile } from '../hooks/useProfiles';
import { useUserCard } from './UserCard';
import type { Message, MessageAttachment } from '@streaming/shared-types';
import { File as FileIcon, MoreHorizontal } from 'lucide-react';
import EmptyState from './EmptyState';
import Avatar from './Avatar';
import { fullTimestamp, relativeTime } from '../lib/format';
import { resolveAttachmentUrl } from '../lib/api';
import { MessageListSkeleton } from './Skeleton';

interface Group {
  userId: string;
  username: string;
  messages: Message[];
}

const GROUP_GAP_MS = 5 * 60 * 1000;

function groupMessages(messages: Message[]): Group[] {
  const groups: Group[] = [];
  for (const message of messages) {
    const last = groups[groups.length - 1];
    const lastMessage = last?.messages[last.messages.length - 1];
    const withinGap =
      lastMessage && new Date(message.createdAt).getTime() - new Date(lastMessage.createdAt).getTime() < GROUP_GAP_MS;

    if (last && last.userId === message.userId && withinGap) {
      last.messages.push(message);
    } else {
      groups.push({ userId: message.userId, username: message.username, messages: [message] });
    }
  }
  return groups;
}

export default function MessageList({
  messages: allMessages,
  currentUserId,
  loading,
  onAtBottomChange,
  messageActions,
}: {
  /** Optional per-message overflow menu entries (e.g. delete / moderate). Empty/undefined = no menu. */
  messageActions?: (message: Message) => MessageAction[];
  messages: Message[];
  currentUserId: string;
  loading: boolean;
  /** Reports whether the view is scrolled to (near) the latest message — used to gate the new-message sound. */
  onAtBottomChange?: (atBottom: boolean) => void;
}) {
  // Blocked users' messages are filtered server-side (history + live fan-out); this is the
  // client-side safety net (e.g. a block made moments ago, or the server filter degraded).
  const { isBlocked } = useBlocks();
  const messages = useMemo(() => allMessages.filter((m) => !isBlocked(m.userId)), [allMessages, isBlocked]);
  const authorIds = useMemo(() => Array.from(new Set(messages.map((m) => m.userId))), [messages]);
  const profiles = useProfiles(authorIds);
  const containerRef = useRef<HTMLDivElement>(null);
  const stuckToBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  // Ids present when the history finished loading. Anything not in here arrived
  // afterwards and gets the slide-in; the initial history never animates.
  const historyIdsRef = useRef<Set<string> | null>(null);
  if (loading) historyIdsRef.current = null;
  else if (historyIdsRef.current === null) historyIdsRef.current = new Set(messages.map((m) => m.id));
  const historyIds = historyIdsRef.current;

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 80;
    stuckToBottomRef.current = atBottom;
    setShowJumpToLatest(!atBottom);
    onAtBottomChange?.(atBottom);
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (stuckToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function jumpToLatest() {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stuckToBottomRef.current = true;
    setShowJumpToLatest(false);
  }

  if (loading) {
    return <MessageListSkeleton />;
  }

  const groups = groupMessages(messages);

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto px-4 py-4">
        {groups.length === 0 && (
          <EmptyState
            character="cat"
            title="No messages yet"
            body="Be the first to say something."
            className="h-full justify-center"
          />
        )}

        <div className="flex flex-col gap-4">
          {groups.map((group, i) => (
            <MessageGroupRow
              key={group.messages[0].id ?? i}
              group={group}
              isSelf={group.userId === currentUserId}
              profile={profiles.get(group.userId)}
              messageActions={messageActions}
              historyIds={historyIds}
            />
          ))}
        </div>
      </div>

      {showJumpToLatest && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 animate-pop-in rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white shadow-lg transition-colors hover:bg-accent-hover"
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}

export interface MessageAction {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

function MessageMenu({ actions, label }: { actions: MessageAction[]; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 text-text-muted hover:bg-hover hover:text-text-primary"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[150px] rounded-lg border border-border bg-panel py-1 shadow-xl"
        >
          {actions.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
              className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-hover ${a.danger ? 'text-danger' : 'text-text-primary'}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageGroupRow({
  group,
  isSelf,
  profile,
  messageActions,
  historyIds,
}: {
  group: Group;
  isSelf: boolean;
  profile?: Profile;
  messageActions?: (message: Message) => MessageAction[];
  historyIds: Set<string> | null;
}) {
  const first = group.messages[0];
  const { openUserCard } = useUserCard();
  const shownName = profile?.displayName || group.username;
  const isNew = (m: Message) => !!historyIds && !historyIds.has(m.id);
  return (
    <div className={`flex items-start gap-3 ${isNew(first) ? 'animate-msg-in' : ''}`}>
      <button
        type="button"
        onClick={() => openUserCard(group.userId, group.username)}
        className="mt-0.5 shrink-0 self-start rounded-full"
        aria-label={`View ${shownName}'s profile`}
      >
        <Avatar name={group.username} src={profile?.avatarUrl} preset={profile?.avatarPreset} size={36} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            onClick={() => openUserCard(group.userId, group.username)}
            className={`text-sm font-semibold hover:underline ${isSelf ? 'text-accent' : 'text-text-primary'}`}
          >
            {shownName}
          </button>
          <span className="text-[11px] text-text-muted" title={fullTimestamp(first.createdAt)}>
            {relativeTime(first.createdAt)}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {group.messages.map((m) => {
            const actions = messageActions?.(m) ?? [];
            return (
              <div
                key={m.id}
                className={`group/msg relative flex flex-col gap-1.5 ${m !== first && isNew(m) ? 'animate-msg-in' : ''}`}
              >
                {actions.length > 0 && (
                  <div className="absolute right-0 top-0 opacity-100 md:opacity-0 md:group-hover/msg:opacity-100 md:focus-within:opacity-100">
                    <MessageMenu actions={actions} label={`Message options for ${m.username}`} />
                  </div>
                )}
                {m.content && (
                  <p className={`whitespace-pre-wrap break-words ${actions.length > 0 ? 'pr-7' : ''} text-sm leading-relaxed text-text-primary/90`}>
                    {m.content}
                  </p>
                )}
                {m.attachment && <AttachmentView attachment={m.attachment} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AttachmentView({ attachment }: { attachment: MessageAttachment }) {
  const url = resolveAttachmentUrl(attachment);
  const isImage = attachment.mimeType.startsWith('image/');

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img
          src={url}
          alt={attachment.filename}
          className="max-h-[300px] max-w-full rounded-lg border border-border object-contain"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={attachment.filename}
      className="flex w-fit items-center gap-2 rounded-lg border border-border bg-hover/60 px-3 py-2 text-sm text-text-primary hover:bg-hover"
    >
      <FileIcon size={16} className="shrink-0 text-text-muted" />
      <span className="truncate">{attachment.filename}</span>
    </a>
  );
}
