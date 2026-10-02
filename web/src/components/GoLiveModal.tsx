import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GuidelinesResponse, StreamEligibility } from '@streaming/shared-types';
import { CheckCircle2, CircleSlash, Radio, Users, Crown, Sparkles } from 'lucide-react';
import { ApiError } from '../lib/api';
import {
  acceptGuidelines,
  createStream,
  getEligibility,
  getGuidelines,
  getGuidelinesStatus,
  listLiveStreams,
} from '../lib/streams';
import { useSession } from '../context/SessionContext';
import Modal from './Modal';
import GuidelinesModal from './GuidelinesModal';
import ErrorBanner from './ErrorBanner';
import Spinner from './Spinner';

type Step =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ineligible'; eligibility: StreamEligibility }
  | { kind: 'guidelines'; guidelines: GuidelinesResponse }
  | { kind: 'form' }
  | { kind: 'already_live'; streamId: string | null };

export default function GoLiveModal({ onClose }: { onClose: () => void }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const token = session?.accessToken ?? '';

  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function startFlow() {
    setStep({ kind: 'loading' });
    try {
      const eligibility = await getEligibility(token);
      if (!eligibility.eligible) {
        setStep({ kind: 'ineligible', eligibility });
        return;
      }
      const status = await getGuidelinesStatus(token);
      if (!status.accepted) {
        setStep({ kind: 'guidelines', guidelines: await getGuidelines(token) });
        return;
      }
      setStep({ kind: 'form' });
    } catch (err) {
      setStep({ kind: 'error', message: (err as Error).message });
    }
  }

  useEffect(() => {
    if (token) startFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function resolveOwnLiveStreamId(known: unknown): Promise<string | null> {
    if (typeof known === 'string') return known;
    try {
      const live = await listLiveStreams(token);
      return live.find((s) => s.hostId === session?.user.id)?.id ?? null;
    } catch {
      return null;
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const stream = await createStream(token, trimmed, description.trim() || undefined);
      onClose();
      navigate(`/live/${stream.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'already_live') {
          setStep({ kind: 'already_live', streamId: await resolveOwnLiveStreamId(err.body.streamId) });
        } else if (err.code === 'guidelines_not_accepted') {
          try {
            setStep({ kind: 'guidelines', guidelines: await getGuidelines(token) });
          } catch (inner) {
            setFormError((inner as Error).message);
          }
        } else if (err.code === 'not_eligible') {
          const body = err.body as Partial<StreamEligibility>;
          setStep({
            kind: 'ineligible',
            eligibility: {
              eligible: false,
              admin: !!body.admin,
              premium: !!body.premium,
              followerCount: body.followerCount ?? 0,
              minFollowers: body.minFollowers ?? 500,
              bridge: body.bridge ?? 'unavailable',
              reasons: body.reasons ?? [],
            },
          });
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError((err as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (step.kind === 'guidelines') {
    return (
      <GuidelinesModal
        rules={step.guidelines.rules}
        version={step.guidelines.version}
        onClose={onClose}
        onAccept={async (version) => {
          await acceptGuidelines(token, version);
          setStep({ kind: 'form' });
        }}
      />
    );
  }

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <Radio size={18} className="text-danger" /> Go live
        </span>
      }
      onClose={onClose}
      dismissible={!submitting}
    >
      {step.kind === 'loading' && (
        <div className="flex flex-col items-center gap-3 px-5 py-10 text-sm text-text-secondary">
          <Spinner size={24} />
          Checking whether you can host…
        </div>
      )}

      {step.kind === 'error' && (
        <div className="flex flex-col gap-3 px-5 py-4">
          <ErrorBanner message={step.message} />
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-hover">
              Close
            </button>
            <button
              onClick={startFlow}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {step.kind === 'ineligible' && <IneligiblePanel eligibility={step.eligibility} onClose={onClose} />}

      {step.kind === 'already_live' && (
        <div className="flex flex-col gap-4 px-5 py-4">
          <ErrorBanner message="You already have a live stream. End it before starting another." />
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-hover">
              Close
            </button>
            {step.streamId && (
              <button
                onClick={() => {
                  onClose();
                  navigate(`/live/${step.streamId}`);
                }}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                Return to your stream
              </button>
            )}
          </div>
        </div>
      )}

      {step.kind === 'form' && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-4">
          {formError && <ErrorBanner message={formError} onDismiss={() => setFormError(null)} />}
          <div>
            <label htmlFor="golive-title" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Title
            </label>
            <input
              id="golive-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              required
              autoFocus
              placeholder="What's this stream about?"
              className="w-full rounded-lg border border-border bg-base px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <p className="mt-1 text-right text-[11px] text-text-muted">{title.length}/100</p>
          </div>
          <div>
            <label htmlFor="golive-desc" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Description <span className="font-normal normal-case text-text-muted">(optional)</span>
            </label>
            <textarea
              id="golive-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Topics, schedule, rules for Q&A…"
              className="w-full resize-none rounded-lg border border-border bg-base px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <p className="mt-1 text-right text-[11px] text-text-muted">{description.length}/500</p>
          </div>
          <p className="text-xs text-text-muted">
            You'll be the host and pick who speaks. Review the{' '}
            <Link to="/guidelines" target="_blank" className="text-accent hover:underline">
              community guidelines
            </Link>
            .
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-hover disabled:opacity-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className="flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Spinner size={14} className="text-white" /> : <Radio size={14} />}
              Go live
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function IneligiblePanel({ eligibility, onClose }: { eligibility: StreamEligibility; onClose: () => void }) {
  const { premium, followerCount, minFollowers, bridge } = eligibility;
  const pct = Math.min(100, Math.round((followerCount / Math.max(1, minFollowers)) * 100));

  let premiumText: string;
  let premiumOk = false;
  if (premium) {
    premiumText = 'Yes - Elonix bot premium is active';
    premiumOk = true;
  } else if (bridge === 'unavailable') {
    premiumText = 'Premium check temporarily unavailable';
  } else {
    premiumText = 'No Elonix bot premium found';
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <p className="text-sm text-text-primary">
        You can't host a live stream yet. Hosting is open to people who meet at least one of these:
      </p>

      <ul className="flex flex-col gap-3">
        <li className="rounded-lg border border-border bg-base px-3.5 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Crown size={15} className="text-warning" /> Elonix bot premium
            <span className="ml-auto">
              {premiumOk ? <CheckCircle2 size={16} className="text-success" /> : <CircleSlash size={16} className="text-text-muted" />}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary">{premiumText}</p>
        </li>

        <li className="rounded-lg border border-border bg-base px-3.5 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Users size={15} className="text-accent" /> {minFollowers} followers
            <span className="ml-auto text-xs text-text-secondary">
              {followerCount}/{minFollowers}
            </span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-hover"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={minFollowers}
            aria-valuenow={Math.min(followerCount, minFollowers)}
            aria-label="Follower progress"
          >
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
        </li>

        <li className="flex items-center gap-2 rounded-lg border border-border bg-base px-3.5 py-3 text-sm text-text-primary">
          <Sparkles size={15} className="text-violet-400" /> Elonix team member (admin)
        </li>
      </ul>

      {bridge === 'unavailable' && !premium && (
        <p className="text-xs text-text-muted">
          We couldn't verify premium right now, so you may be eligible. Try again in a few minutes.
        </p>
      )}

      <div className="flex justify-end">
        <button onClick={onClose} className="rounded-lg bg-hover px-4 py-2 text-sm font-medium text-text-primary hover:bg-border">
          Close
        </button>
      </div>
    </div>
  );
}
