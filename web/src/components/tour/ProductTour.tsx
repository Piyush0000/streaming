import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { cx } from '../../lib/format';
import { safeGet, safeSet } from '../../lib/motion';

interface TourStep {
  /** Matches a `data-tour="..."` attribute on a real element. */
  target: string;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    target: 'channels',
    title: 'Your channels',
    body: 'Text channels live here. Pick one to read the conversation and chat in real time.',
  },
  {
    target: 'voice-channels',
    title: 'Voice channels',
    body: 'Drop into a voice channel to talk live. Share your screen from the panel once you have joined.',
  },
  {
    target: 'live',
    title: 'Go live',
    body: 'Browse live rooms, listen in and ask to speak - or hit Go live to host your own stream.',
  },
  {
    target: 'hub',
    title: 'Elonix Hub',
    body: 'The community feed: share setups, charts and ideas with other traders.',
  },
  {
    target: 'profile',
    title: 'Your profile',
    body: 'Your account and sign out live here. Use the help button any time to replay this tour.',
  },
];

interface TourContextValue {
  /** Starts (or restarts) the tour. Safe to call anywhere; a no-op if nothing can be shown. */
  startTour: () => void;
}

const TourContext = createContext<TourContextValue>({ startTour: () => {} });

export function useTour(): TourContextValue {
  return useContext(TourContext);
}

const CARD_W = 320;
const PAD = 6;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function findTarget(name: string): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
  } catch {
    return null;
  }
}

function measure(name: string): Box | null {
  const el = findTarget(name);
  if (!el) return null;
  try {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) return null;
    return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
  } catch {
    return null;
  }
}

function isMobile(): boolean {
  try {
    return window.matchMedia('(max-width: 767px)').matches;
  } catch {
    return false;
  }
}

/**
 * First-run product tour. Wrap the authenticated shell; it auto-starts once per
 * user (localStorage) and can be replayed via `useTour().startTour()`.
 * `setSidebarOpen` lets it reveal the off-canvas sidebar on mobile.
 */
export function TourProvider({
  userId,
  setSidebarOpen,
  children,
}: {
  userId?: string;
  setSidebarOpen?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(200);
  const [vp, setVp] = useState({ w: 1024, h: 768 });
  const dirRef = useRef<1 | -1>(1);
  const openedSidebarRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const storageKey = `elonix:tour:done:${userId ?? 'anon'}`;

  const finish = useCallback(() => {
    safeSet(storageKey, '1');
    setActive(false);
    setBox(null);
    if (openedSidebarRef.current) {
      openedSidebarRef.current = false;
      try {
        setSidebarOpen?.(false);
      } catch {
        /* ignore */
      }
    }
  }, [storageKey, setSidebarOpen]);

  const start = useCallback(
    (auto: boolean) => {
      try {
        const available = STEPS.filter((s) => findTarget(s.target));
        if (available.length === 0) return; // nothing to point at (yet): don't consume the first-run flag
        if (auto && document.querySelector('[role="dialog"]')) return;
        if (isMobile() && setSidebarOpen) {
          openedSidebarRef.current = true;
          setSidebarOpen(true);
        }
        dirRef.current = 1;
        setSteps(available);
        setIndex(0);
        setBox(null);
        setActive(true);
      } catch {
        setActive(false);
      }
    },
    [setSidebarOpen]
  );

  // First-run auto start, once per user. Never on invite links.
  useEffect(() => {
    if (!userId) return;
    if (safeGet(storageKey)) return;
    if (window.location.pathname.startsWith('/invite')) return;
    const timer = window.setTimeout(() => start(true), 1600);
    return () => window.clearTimeout(timer);
  }, [userId, storageKey, start]);

  // Measure the current target; skip the step if it is gone.
  const step = active ? steps[index] : undefined;
  useEffect(() => {
    if (!active || !step) return;
    let cancelled = false;

    let misses = 0;
    const apply = () => {
      if (cancelled) return;
      setVp({ w: window.innerWidth, h: window.innerHeight });
      const measured = measure(step.target);
      if (measured) misses = 0;
      if (!measured) {
        // A drawer that is still sliding in (slow phones, in-app browsers) looks like a missing target:
        // only give up on the step after a few consecutive misses.
        misses += 1;
        if (misses < 4) return;
        // Target missing or off-screen: move on in the direction we were travelling.
        const ni = index + dirRef.current;
        if (ni >= steps.length) finish();
        else if (ni < 0) {
          dirRef.current = 1;
          setIndex(Math.min(1, steps.length - 1));
        } else setIndex(ni);
        return;
      }
      setBox((prev) =>
        prev && prev.x === measured.x && prev.y === measured.y && prev.w === measured.w && prev.h === measured.h
          ? prev
          : measured
      );
    };

    try {
      findTarget(step.target)?.scrollIntoView({ block: 'nearest' });
    } catch {
      /* ignore */
    }
    // Let the mobile drawer finish sliding in before the first measurement.
    const first = window.setTimeout(apply, isMobile() && index === 0 ? 300 : 30);
    const poll = window.setInterval(apply, 500);
    window.addEventListener('resize', apply);
    window.addEventListener('scroll', apply, true);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(poll);
      window.removeEventListener('resize', apply);
      window.removeEventListener('scroll', apply, true);
    };
  }, [active, step, index, steps.length, finish]);

  useLayoutEffect(() => {
    if (!active) return;
    const h = cardRef.current?.offsetHeight;
    if (h && h !== cardH) setCardH(h);
  });

  const hasBox = !!box;
  useEffect(() => {
    if (active && hasBox) nextBtnRef.current?.focus({ preventScroll: true });
  }, [active, index, hasBox]);

  const go = useCallback((delta: 1 | -1) => {
    dirRef.current = delta;
    setIndex((i) => Math.max(0, i + delta));
  }, []);

  const next = useCallback(() => {
    if (index >= steps.length - 1) finish();
    else go(1);
  }, [index, steps.length, finish, go]);

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      } else if (e.key === 'ArrowRight') {
        next();
      } else if (e.key === 'ArrowLeft' && index > 0) {
        go(-1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, next, go, index, finish]);

  const value = useMemo<TourContextValue>(() => ({ startTour: () => start(false) }), [start]);

  // Card placement (transform-only, so it glides between steps).
  let cardPos = { x: 12, y: 12, w: Math.min(CARD_W, vp.w - 24) };
  if (box) {
    const w = Math.min(CARD_W, vp.w - 24);
    if (vp.w < 640) {
      const centerY = box.y + box.h / 2;
      const y = centerY > vp.h / 2 ? 12 : vp.h - cardH - 12;
      cardPos = { x: (vp.w - w) / 2, y: Math.max(12, y), w };
    } else if (box.x + box.w + 16 + w <= vp.w - 12) {
      const y = Math.min(Math.max(12, box.y + box.h / 2 - cardH / 2), vp.h - cardH - 12);
      cardPos = { x: box.x + box.w + 16, y: Math.max(12, y), w };
    } else {
      const below = box.y + box.h + 12;
      const y = below + cardH + 12 <= vp.h ? below : Math.max(12, box.y - cardH - 12);
      cardPos = { x: Math.min(Math.max(12, box.x), vp.w - w - 12), y, w };
    }
  }

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && step && (
        <div className="fixed inset-0 z-[80]" role="presentation">
          {/* swallow clicks so the app underneath can't be used mid-tour */}
          <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />
          {box && (
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 animate-fade-in rounded-xl transition-transform duration-slow ease-out-expo"
              style={{
                width: box.w,
                height: box.h,
                transform: `translate3d(${box.x}px, ${box.y}px, 0)`,
                boxShadow: '0 0 0 9999px rgba(2, 6, 16, 0.72), 0 0 0 2px rgba(59, 130, 246, 0.9)',
              }}
            />
          )}
          {box && (
            <div
              className="absolute left-0 top-0 transition-transform duration-slow ease-out-expo"
              style={{ width: cardPos.w, transform: `translate3d(${cardPos.x}px, ${cardPos.y}px, 0)` }}
            >
              <div
                key={index}
                ref={cardRef}
                role="dialog"
                aria-modal="true"
                aria-label={`Tour: ${step.title}`}
                className="animate-pop-in rounded-xl border border-border bg-panel p-4 shadow-2xl"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-sm font-semibold text-text-primary">{step.title}</h2>
                  <button
                    onClick={finish}
                    className="-mr-1 -mt-1 rounded p-1 text-text-muted hover:bg-hover hover:text-text-primary"
                    aria-label="Skip tour"
                  >
                    <X size={14} />
                  </button>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{step.body}</p>

                <div className="mt-4 flex items-center gap-3">
                  <div className="flex items-center gap-1.5" aria-label={`Step ${index + 1} of ${steps.length}`}>
                    {steps.map((s, i) => (
                      <span
                        key={s.target}
                        className={cx(
                          'h-1.5 w-1.5 origin-center rounded-full transition-transform duration-base ease-spring',
                          i === index ? 'scale-125 bg-accent' : 'scale-100 bg-border'
                        )}
                      />
                    ))}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {index === 0 ? (
                      <button
                        onClick={finish}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover hover:text-text-primary"
                      >
                        Skip
                      </button>
                    ) : (
                      <button
                        onClick={() => go(-1)}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover hover:text-text-primary"
                      >
                        <ArrowLeft size={12} /> Back
                      </button>
                    )}
                    <button
                      ref={nextBtnRef}
                      onClick={next}
                      className="btn-shine flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
                    >
                      {index >= steps.length - 1 ? 'Done' : 'Next'}
                      {index < steps.length - 1 && <ArrowRight size={12} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </TourContext.Provider>
  );
}
