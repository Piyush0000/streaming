import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import Modal from './Modal';

/** Shown to a user the host just warned. The final (max/max) warning gets stronger copy. */
export default function WarningModal({
  warnings,
  max,
  reason,
  onClose,
}: {
  warnings: number;
  max: number;
  reason?: string;
  onClose: () => void;
}) {
  const isFinal = warnings >= max;
  return (
    <Modal
      title={
        <span className="flex items-center gap-2 text-warning">
          <TriangleAlert size={18} /> {isFinal ? 'Final warning' : 'Warning'} {warnings} of {max}
        </span>
      }
      onClose={onClose}
      tone="warning"
      size="sm"
    >
      <div className="flex flex-col gap-3 px-5 py-4" role="alertdialog" aria-live="assertive">
        <p className="text-sm text-text-primary">
          The host warned you{reason ? <>: <span className="font-medium">{reason}</span></> : '.'}
        </p>
        <p className="text-sm text-text-secondary">
          {isFinal
            ? `This was your last warning. Any further violation will get you removed and banned from this stream.`
            : `You can receive ${max} warnings. After that, a further violation will get you removed from the stream.`}
        </p>
        <Link to="/guidelines" target="_blank" className="w-fit text-xs text-accent hover:underline">
          Read the community guidelines
        </Link>
        <button
          onClick={onClose}
          autoFocus
          className="self-end rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          I understand
        </button>
      </div>
    </Modal>
  );
}
