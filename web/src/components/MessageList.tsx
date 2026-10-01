import { useEffect, useRef, useState } from 'react';
import type { Message } from '@streaming/shared-types';
import { MessageSquare } from 'lucide-react';
import Avatar from './Avatar';
import { fullTimestamp, relativeTime } from '../lib/format';
import { FullPageSpinner } from './Spinner';

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
  messages,
  currentUserId,
  loading,
}: {
  messages: Message[];
  currentUserId: string;
  loading: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stuckToBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 80;
    stuckToBottomRef.current = atBottom;
    setShowJumpToLatest(!atBottom);
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
    return <FullPageSpinner label="Loading messages…" />;
  }

  const groups = groupMessages(messages);

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto px-4 py-4">
        {groups.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-text-secondary">
            <MessageSquare size={32} className="mb-3 text-text-muted" />
            <p className="text-sm font-medium text-text-primary">No messages yet</p>
            <p className="mt-1 text-xs text-text-muted">Be the first to say something.</p>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {groups.map((group, i) => (
            <MessageGroupRow key={group.messages[0].id ?? i} group={group} isSelf={group.userId === currentUserId} />
          ))}
        </div>
      </div>

      {showJumpToLatest && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white shadow-lg transition-colors hover:bg-accent-hover"
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}

function MessageGroupRow({ group, isSelf }: { group: Group; isSelf: boolean }) {
  const first = group.messages[0];
  return (
    <div className="flex items-start gap-3">
      <Avatar name={group.username} size={36} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-semibold ${isSelf ? 'text-accent' : 'text-text-primary'}`}>
            {group.username}
          </span>
          <span className="text-[11px] text-text-muted" title={fullTimestamp(first.createdAt)}>
            {relativeTime(first.createdAt)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          {group.messages.map((m) => (
            <p key={m.id} className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-primary/90">
              {m.content}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
