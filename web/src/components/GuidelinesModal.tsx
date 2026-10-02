import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import Modal from './Modal';
import ErrorBanner from './ErrorBanner';
import Spinner from './Spinner';

export function GuidelinesRules({ rules }: { rules: string[] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {rules.map((rule, i) => (
        <li key={i} className="flex gap-3 text-sm leading-relaxed text-text-primary/90">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
            {i + 1}
          </span>
          <span>{rule}</span>
        </li>
      ))}
    </ol>
  );
}

/** Rules + explicit "I agree" checkbox; `onAccept` records the acceptance server-side. */
export default function GuidelinesModal({
  rules,
  version,
  onAccept,
  onClose,
}: {
  rules: string[];
  version: number;
  onAccept: (version: number) => Promise<void>;
  onClose: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setError(null);
    setSubmitting(true);
    try {
      await onAccept(version);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-accent" /> Community guidelines
        </span>
      }
      onClose={onClose}
      dismissible={!submitting}
      size="lg"
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="text-sm text-text-secondary">
          Hosting a live stream means you moderate a room. Please read and accept the rules before you go live.
        </p>
        <GuidelinesRules rules={rules} />
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-base px-3 py-2.5 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span>I have read and agree to follow the Elonix community guidelines.</span>
        </label>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={!agreed || submitting}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Spinner size={14} className="text-white" />}
            I agree
          </button>
        </div>
      </div>
    </Modal>
  );
}
