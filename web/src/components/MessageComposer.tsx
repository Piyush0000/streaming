import { FormEvent, useState } from 'react';
import { Send } from 'lucide-react';

export default function MessageComposer({
  onSend,
  disabled,
  placeholder,
}: {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft('');
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border bg-panel px-4 py-3">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 rounded-lg border border-border bg-base px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || !draft.trim()}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Send message"
      >
        <Send size={16} />
      </button>
    </form>
  );
}
