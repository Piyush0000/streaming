import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GuidelinesResponse } from '@streaming/shared-types';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { getGuidelines } from '../lib/streams';
import { GuidelinesRules } from '../components/GuidelinesModal';
import ErrorBanner from '../components/ErrorBanner';
import { FullPageSpinner } from '../components/Spinner';
import { STREAM_MAX_WARNINGS } from '../lib/streamLimits';

/** /guidelines - the rules every live-stream host and participant agrees to. */
export default function GuidelinesPage() {
  const { session } = useSession();
  const [data, setData] = useState<GuidelinesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getGuidelines(session.accessToken)
      .then((g) => !cancelled && setData(g))
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [session]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6">
        <Link to="/live" className="flex w-fit items-center gap-1.5 text-xs text-text-muted hover:text-accent">
          <ArrowLeft size={13} /> Back to live streams
        </Link>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Community guidelines</h1>
            {data && <p className="text-xs text-text-muted">Version {data.version}</p>}
          </div>
        </div>

        {error && <ErrorBanner message={error} />}
        {!data && !error && (
          <div className="h-40">
            <FullPageSpinner label="Loading guidelines…" />
          </div>
        )}
        {data && (
          <>
            <div className="rounded-2xl border border-border bg-panel p-5">
              <GuidelinesRules rules={data.rules} />
            </div>
            <p className="text-xs text-text-muted">
              Hosts and platform admins can warn, mute, remove or ban people who break these rules. After{' '}
              {STREAM_MAX_WARNINGS} warnings, a further violation results in removal from the stream.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
