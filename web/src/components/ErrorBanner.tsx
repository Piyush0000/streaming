import { AlertTriangle, X } from 'lucide-react';

export default function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1 break-words">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 text-danger/70 hover:bg-danger/20 hover:text-danger"
          aria-label="Dismiss error"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
