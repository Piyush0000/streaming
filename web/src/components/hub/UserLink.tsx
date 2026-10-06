import { Link } from 'react-router-dom';
import Avatar from '../Avatar';
import { hubPath, type HubAuthor } from '../../lib/hub';
import { cx } from '../../lib/format';

/** Avatar (preset/URL/initial) linking to the author's hub profile. */
export function AuthorAvatar({ author, size = 24 }: { author: HubAuthor; size?: number }) {
  if (author.username === 'deleted') return <Avatar name="?" size={size} />;
  return (
    <Link to={hubPath.user(author.username)} aria-label={`u/${author.username}`} className="shrink-0 rounded-full">
      <Avatar name={author.username} src={author.avatarUrl} preset={author.avatarPreset} size={size} />
    </Link>
  );
}

/** u/username link to the hub profile page. */
export default function UserLink({ author, className }: { author: HubAuthor; className?: string }) {
  if (author.username === 'deleted') return <span className={cx('text-text-muted', className)}>[deleted]</span>;
  return (
    <Link
      to={hubPath.user(author.username)}
      className={cx('truncate font-medium text-text-secondary hover:text-accent hover:underline', className)}
    >
      u/{author.username}
    </Link>
  );
}
