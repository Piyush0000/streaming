import { ChangeEvent, FormEvent, useRef, useState } from 'react';
import { Paperclip, Send } from 'lucide-react';
import type { MessageAttachment } from '@streaming/shared-types';
import { uploadFile } from '../lib/api';
import ErrorBanner from './ErrorBanner';

export default function MessageComposer({
  onSend,
  accessToken,
  disabled,
  placeholder,
}: {
  onSend: (content: string, attachment?: MessageAttachment | null) => void;
  accessToken: string;
  disabled?: boolean;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft('');
  }

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
      setUploadError((err as Error).message);
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
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={handleFileSelected}
          disabled={disabled || uploading}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
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
          className="flex-1 rounded-lg border border-border bg-base px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || uploading || !draft.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
