import { Globe, Link2 } from 'lucide-react';
import { cx } from '../lib/format';
import { sourceLabel } from '../lib/joinToasts';

// Original letter badges (no brand artwork).
const LETTER: Record<string, { text: string; cls: string }> = {
  x: { text: 'X', cls: 'bg-neutral-800 text-white' },
  facebook: { text: 'f', cls: 'bg-blue-600 text-white' },
  instagram: { text: 'IG', cls: 'bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white' },
  youtube: { text: 'YT', cls: 'bg-red-600 text-white' },
  reddit: { text: 'R', cls: 'bg-orange-600 text-white' },
  telegram: { text: 'T', cls: 'bg-sky-500 text-white' },
  whatsapp: { text: 'W', cls: 'bg-green-600 text-white' },
  google: { text: 'G', cls: 'bg-slate-500 text-white' },
};

export default function SourceBadge({ source, size = 18 }: { source: string; size?: number }) {
  const l = LETTER[source];
  const title = sourceLabel(source) ?? (source === 'direct' ? 'Direct' : 'Other');
  if (!l) {
    const Icon = source === 'direct' ? Link2 : Globe;
    return (
      <span
        title={title}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-hover text-text-muted"
        style={{ width: size, height: size }}
      >
        <Icon size={Math.round(size * 0.6)} />
      </span>
    );
  }
  return (
    <span
      title={title}
      aria-label={title}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none', l.cls)}
      style={{ width: size, height: size, fontSize: Math.round(size * (l.text.length > 1 ? 0.42 : 0.56)) }}
    >
      {l.text}
    </span>
  );
}
