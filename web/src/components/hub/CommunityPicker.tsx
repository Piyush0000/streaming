import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cx } from '../../lib/format';
import { useHubCommunities } from './hubCommunities';
import { CommunityDot } from './HubSidebar';

/** Searchable community dropdown. `value` is a slug or '' (no community). */
export default function CommunityPicker({ value, onChange }: { value: string; onChange: (slug: string) => void }) {
  const { communities, loading } = useHubCommunities();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = [...communities].sort((a, b) => Number(b.joined) - Number(a.joined) || a.slug.localeCompare(b.slug));
    return t ? list.filter((c) => c.slug.includes(t) || c.name.toLowerCase().includes(t)) : list;
  }, [communities, q]);
  // option 0 is always "No community"
  const options = useMemo(() => [{ slug: '', label: 'No community' }, ...filtered.map((c) => ({ slug: c.slug, label: `c/${c.slug}` }))], [filtered]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => setActive(0), [q, open]);

  function choose(slug: string) {
    onChange(slug);
    setOpen(false);
    setQ('');
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-border bg-base px-3 py-2 text-left text-sm outline-none transition-colors hover:border-accent/50 focus-visible:border-accent sm:w-72"
      >
        {value ? <CommunityDot slug={value} size={20} /> : null}
        <span className={cx('min-w-0 flex-1 truncate', !value && 'text-text-secondary')}>{value ? `c/${value}` : 'Choose a community (optional)'}</span>
        <ChevronDown size={15} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full animate-pop-in rounded-xl border border-border bg-panel p-2 shadow-2xl sm:w-72">
          <div className="relative mb-2">
            <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              autoFocus={!(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)}
              value={q}
              onChange={(e) => setQ(e.target.value.slice(0, 40))}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(options.length - 1, a + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(options[active]?.slug ?? '');
                } else if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
              aria-label="Search communities"
              placeholder="Search communities"
              className="min-h-[44px] w-full rounded-lg border border-border bg-base py-1.5 pl-8 pr-2 text-sm outline-none focus:border-accent sm:min-h-0"
            />
          </div>
          <ul id={listId} role="listbox" aria-label="Communities" className="max-h-60 overflow-y-auto">
            {options.map((o, i) => (
              <li
                key={o.slug || '__none'}
                role="option"
                aria-selected={o.slug === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.slug)}
                className={cx('flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm sm:min-h-0', i === active && 'bg-hover')}
              >
                {o.slug ? <CommunityDot slug={o.slug} size={20} /> : <span className="w-5" />}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.slug === value && <Check size={14} className="text-accent" />}
              </li>
            ))}
            {loading && communities.length === 0 && <li className="px-2 py-2 text-xs text-text-muted">Loading…</li>}
            {!loading && filtered.length === 0 && <li className="px-2 py-2 text-xs text-text-muted">No matching communities.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
