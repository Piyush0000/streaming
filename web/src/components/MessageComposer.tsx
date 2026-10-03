import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Timer } from 'lucide-react';
import type { MessageAttachment } from '@streaming/shared-types';
import { RateLimitedError, uploadFile } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useCountdown } from '../hooks/useCountdown';
import ErrorBanner from './ErrorBanner';

export default function MessageComposer({
  onSend,
  accessToken,
  disabled,
  placeholder,
  rateLimitedUntil,
}: {
  onSend: (content: string, attachment?: MessageAttachment | null) => void;
  accessToken: string;
  disabled?: boolean;
  placeholder: string;
  /** Epoch ms until which sending is blocked by the server's rate limit (null/undefined = not limited). */
  rateLimitedUntil?: number | null;
}) {
  const { showToast } = useToast();
  const secondsLeft = useCountdown(rateLimitedUntil);
  const limited = secondsLeft > 0;
  const lastSentRef = useRef('');
  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (limited) return;
    lastSentRef.current = trimmed;
    onSend(trimmed);
    setDraft('');
  }

  // The server rejected the last message as "too fast": put the text back so nothing is lost.
  useEffect(() => {
    if (rateLimitedUntil && lastSentRef.current) {
      setDraft((cur) => (cur === '' ? lastSentRef.current : cur));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateLimitedUntil]);

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    setUploadError(null);
    setUploading(true);
    try {
      const attachment = await uploadFile(accessToken, file);
      onSend(draft.trim(), attachment);
      setDraft('');
    } catch (err) {
      if (err instanceof RateLimitedError) {
        const secs = Math.max(1, Math.ceil(err.retryAfterMs / 1000));
        showToast(`Uploading too fast — try again in ${secs}s`, 'warning');
      } else {
        setUploadError((err as Error).message);
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border-t border-border bg-panel px-4 py-3">
      {uploadError && (
        <div className="mb-2">
          <ErrorBanner message={uploadError} onDismiss={() => setUploadError(null)} />
        </div>
      )}
      {limited && (
        <p role="status" className="mb-2 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <Timer size={14} aria-hidden />
          You're sending messages too fast. You can send again in {secondsLeft}s.
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={handleFileSelected}
          disabled={disabled || uploading || limited}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading || limited}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Attach file"
          title="Attach file"
        >
          <Paperclip size={16} />
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={uploading ? 'Uploading…' : placeholder}
          disabled={disabled || uploading}
          aria-label={placeholder}
          className="flex-1 rounded-lg border border-border bg-base px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || uploading || limited || !draft.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
