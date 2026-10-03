import { Lock } from 'lucide-react';
import NoticeScreen from './NoticeScreen';

/**
 * Shown for a channel the user can't open: a private channel they aren't in,
 * a deleted channel, or a stale link. Deliberately doesn't reveal which.
 */
export default function AccessDenied({ message }: { message?: string }) {
  return (
    <NoticeScreen
      icon={<Lock size={28} />}
      tone="warning"
      title="You don't have access to this channel"
      message={
        message ??
        "It may be private, or it may have been deleted. If you were invited, open your invite link again; otherwise ask a member for a new one."
      }
      actionLabel="Back to channels"
      actionTo="/channels"
    />
  );
}
