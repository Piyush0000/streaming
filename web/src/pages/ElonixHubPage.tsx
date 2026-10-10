import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ImagePlus, LinkIcon } from 'lucide-react';
import { hubApi, hubPath, type HubSort, type HubTime } from '../lib/hub';
import { useHubAuth } from '../hooks/useHubAuth';
import Avatar from '../components/Avatar';
import HubShell from '../components/hub/HubShell';
import FeedList, { FeedControls, useFeedView } from '../components/hub/FeedList';

/** Elonix Hub home feed. */
export default function ElonixHubPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { token, initializing, username, requireAuth } = useHubAuth();
  const [sort, setSort] = useState<HubSort>('hot');
  const [time, setTime] = useState<HubTime>('day');
  const [joined, setJoined] = useState(false);
  const [view, setView] = useFeedView();

  // "Share to Elonix Hub" from paper trading lands here with router state: forward to the submit page.
  if ((location.state as { share?: unknown } | null)?.share) {
    return <Navigate to={hubPath.submit} replace state={location.state} />;
  }

  const feedJoined = joined && !!token;
  const goSubmit = () => requireAuth() && navigate(hubPath.submit);

  return (
    <HubShell>
      <div className="glass flex items-center gap-2 rounded-2xl p-2.5">
        <Avatar name={username ?? '?'} size={36} />
        <button
          type="button"
          onClick={goSubmit}
          className="tap min-w-0 flex-1 rounded-full border border-border bg-base/60 px-4 py-2 text-left text-sm text-text-secondary transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Create a post
        </button>
        <Link to={hubPath.submit} state={{ tab: 'image' }} aria-label="Post an image" className="tap inline-flex items-center justify-center rounded-lg p-2 text-text-secondary hover:bg-hover hover:text-accent">
          <ImagePlus size={20} />
        </Link>
        <Link to={hubPath.submit} state={{ tab: 'link' }} aria-label="Post a link" className="tap inline-flex items-center justify-center rounded-lg p-2 text-text-secondary hover:bg-hover hover:text-accent">
          <LinkIcon size={20} />
        </Link>
      </div>

      <FeedControls
        sort={sort}
        onSort={setSort}
        time={time}
        onTime={setTime}
        view={view}
        onView={setView}
        joined={token ? joined : undefined}
        onJoined={setJoined}
      />

      <FeedList
        fetchPage={(cursor) => hubApi.listPosts(token, { sort, t: time, feed: feedJoined ? 'joined' : undefined, cursor })}
        resetKey={`${sort}|${time}|${feedJoined}|${token ? 1 : 0}`}
        enabled={!initializing}
        view={view}
        token={token}
        requireAuth={requireAuth}
        emptyTitle={feedJoined ? 'Nothing from your communities yet' : 'No posts yet'}
        emptyBody={feedJoined ? 'Join a few communities or switch off the Joined filter.' : 'Be the first to share a trade, a link or a thought.'}
        emptyAction={
          <button type="button" onClick={goSubmit} className="tap rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
            Create a post
          </button>
        }
      />
    </HubShell>
  );
}
