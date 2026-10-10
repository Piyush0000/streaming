import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';

/** Catch-all 404. */
export default function NotFoundPage() {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-base text-text-primary">
      <EmptyState
        character="robot"
        size={140}
        title="404 - page not found"
        body="That page does not exist or has moved. Our robot checked every chart."
      >
        <Link
          to="/"
          className="tap inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          Back to Elonix
        </Link>
      </EmptyState>
    </div>
  );
}
