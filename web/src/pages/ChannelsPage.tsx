import { Hash } from 'lucide-react';
import { useSession } from '../context/SessionContext';

/**
 * Shown at /channels when no specific channel is selected — a welcome/empty
 * state. The channel list itself lives in the persistent Sidebar.
 */
export default function ChannelsPage() {
  const { session } = useSession();

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Hash size={28} />
      </div>
      <h1 className="text-lg font-semibold text-text-primary">
        Welcome{session ? `, ${session.user.username}` : ''}
      </h1>
      <p className="mt-1.5 max-w-sm text-sm text-text-secondary">
        Pick a channel from the sidebar to start chatting, or create a new one to get things going.
      </p>
    </div>
  );
}
