import { useEffect, useMemo, useRef, useState } from 'react';
import ParticipantTile, { TileModel } from './ParticipantTile';
import { gridColumns, resolveSpotlight } from '../lib/grid';
import { cx } from '../lib/format';

/**
 * Meet-style layout. No spotlight: a responsive grid of 16:9 tiles. With a
 * screen share (or a pinned tile): one large spotlight tile plus a strip of
 * everybody else (below on phones, to the side on large screens).
 */
export default function ParticipantGrid({
  tiles,
  screens = [],
  className,
}: {
  tiles: TileModel[];
  /** Screen-share tiles (ids must start with `screen:`); promoted to the spotlight automatically. */
  screens?: TileModel[];
  className?: string;
}) {
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1024);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth || 1024);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = useMemo(() => [...screens, ...tiles], [screens, tiles]);
  const spotlightId = resolveSpotlight(
    pinnedId,
    screens.map((s) => s.id),
    tiles.map((t) => t.id)
  );
  const spotlight = spotlightId ? all.find((t) => t.id === spotlightId) : undefined;
  const togglePin = (id: string) => setPinnedId((cur) => (cur === id ? null : id));

  if (all.length === 0) return <div ref={containerRef} className={className} />;

  if (spotlight) {
    const rest = all.filter((t) => t.id !== spotlight.id);
    return (
      <div ref={containerRef} className={cx('flex flex-col gap-2 lg:flex-row', className)}>
        <div className="min-w-0 flex-1">
          <div className="mx-auto w-full" style={{ maxWidth: 'min(100%, calc(60vh * 16 / 9))' }}>
            <ParticipantTile tile={spotlight} spotlight pinned={pinnedId === spotlight.id} onTogglePin={togglePin} />
          </div>
        </div>
        {rest.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 lg:max-h-[60vh] lg:w-52 lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pb-0">
            {rest.map((t) => (
              <div key={t.id} className="w-36 shrink-0 sm:w-44 lg:w-full">
                <ParticipantTile tile={t} compact pinned={pinnedId === t.id} onTogglePin={togglePin} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const cols = gridColumns(tiles.length, width);
  return (
    <div ref={containerRef} className={className}>
      <div
        className={cx('grid gap-2 sm:gap-3', cols === 1 && 'mx-auto max-w-2xl')}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {tiles.map((t) => (
          <ParticipantTile key={t.id} tile={t} pinned={false} onTogglePin={togglePin} />
        ))}
      </div>
    </div>
  );
}
