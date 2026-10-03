import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Heart, ImageIcon } from 'lucide-react';
import { hubApi, HubPost } from '../../lib/hub';
import { colorForName, cx, initials } from '../../lib/format';
import PostBadges from './PostBadges';

const MOCKS = [
  { user: 'ava_trades', symbol: 'BTCUSDT', side: 'long' as const, pnl: 12.4, likes: 128, delay: '0s' },
  { user: 'marcus.lee', symbol: 'ETHUSDT', side: 'short' as const, pnl: -3.1, likes: 64, delay: '0.8s' },
  { user: 'priya_r', symbol: 'SOLUSDT', side: 'spot' as const, pnl: 27.9, likes: 211, delay: '1.6s' },
];

export default function HubTeaser() {
  const navigate = useNavigate();
  const [live, setLive] = useState<HubPost[]>([]);

  useEffect(() => {
    let cancelled = false;
    hubApi
      .listPosts(null, null, 3)
      .then((res) => {
        if (!cancelled) setLive(res.posts.slice(0, 3));
      })
      .catch(() => {
        /* silently hide the live strip */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mx-auto max-w-5xl pb-20">
      <div className="mb-8 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger">
          <Heart className="h-3.5 w-3.5 fill-danger" /> COMMUNITY TRADES
        </div>
        <h2 className="mb-3 text-2xl font-extrabold sm:text-3xl">Elonix Hub</h2>
        <p className="mx-auto max-w-xl text-sm text-text-secondary sm:text-base">
          Share your trade screenshots, show your wins (and lessons), and get likes and feedback from other traders.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {MOCKS.map((m) => (
          <div key={m.user} className="animate-hub-float rounded-2xl border border-border bg-panel/70 p-4" style={{ animationDelay: m.delay }}>
            <div className="mb-3 flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ background: colorForName(m.user) }}
              >
                {initials(m.user)}
              </span>
              <span className="text-sm font-semibold">{m.user}</span>
            </div>
            <div className="mb-3 flex aspect-video items-center justify-center rounded-xl bg-gradient-to-br from-accent/20 via-base to-violet-400/10">
              <svg viewBox="0 0 120 50" className="h-3/4 w-3/4" aria-hidden>
                <polyline
                  fill="none"
                  stroke={m.pnl >= 0 ? '#22c55e' : '#ef4444'}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={m.pnl >= 0 ? '0,40 20,34 38,38 58,22 78,26 98,10 120,6' : '0,8 20,14 38,10 58,26 78,22 98,38 120,42'}
                />
              </svg>
            </div>
            <div className="flex items-center justify-between gap-2">
              <PostBadges post={{ symbol: m.symbol, side: m.side, pnlPercent: m.pnl }} />
              <span className="flex items-center gap-1 text-sm text-text-secondary">
                <Heart className={cx('h-4 w-4 fill-danger text-danger animate-heart-bump')} style={{ animationIterationCount: 'infinite', animationDuration: '2s', animationDelay: m.delay }} />
                {m.likes}
              </span>
            </div>
          </div>
        ))}
      </div>

      {live.length > 0 && (
        <div className="mt-10">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-text-secondary">
            <ImageIcon className="h-4 w-4" /> Latest from the community
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {live.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate('/elonixhub')}
                className="overflow-hidden rounded-2xl border border-border bg-panel text-left transition-colors hover:border-accent/40"
              >
                <img src={p.imageUrl} alt={p.caption || `Trade by ${p.author.username}`} loading="lazy" className="aspect-video w-full bg-base object-cover" />
                <div className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-semibold">{p.author.username}</span>
                    <span className="flex shrink-0 items-center gap-1 text-text-secondary">
                      <Heart className="h-4 w-4" /> {p.likeCount}
                    </span>
                  </div>
                  <PostBadges post={p} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex justify-center">
        <button
          onClick={() => navigate('/elonixhub')}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-7 py-3.5 text-sm font-bold text-white shadow-lg transition-all duration-300 hover:scale-105 hover:bg-accent-hover sm:text-base"
        >
          Open Elonix Hub
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
