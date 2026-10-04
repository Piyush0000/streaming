import type { ReactNode } from 'react';
import { cx } from '../lib/format';

/** Shimmering placeholder block. Size/shape via className. Decorative (aria-hidden). */
export default function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('skeleton rounded-md', className)} />;
}

/** Screen-reader friendly wrapper for a group of skeletons. */
function SkeletonRegion({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  );
}

export function MessageListSkeleton() {
  const widths = ['w-2/3', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5'];
  return (
    <SkeletonRegion label="Loading messages" className="flex-1 min-h-0 overflow-hidden px-4 py-4">
      <div className="flex flex-col gap-5">
        {widths.map((w, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className={cx('h-3', w)} />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function ChannelListSkeleton() {
  return (
    <SkeletonRegion label="Loading channels" className="flex flex-col gap-2 px-2 py-2">
      {['w-3/4', 'w-2/3', 'w-4/5', 'w-1/2'].map((w, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 shrink-0" />
          <Skeleton className={cx('h-3.5', w)} />
        </div>
      ))}
    </SkeletonRegion>
  );
}

export function CardGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <SkeletonRegion label="Loading" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-2xl border border-border bg-panel p-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-2/3" />
          <div className="mt-3 flex items-center gap-2">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

export function StreamPageSkeleton() {
  return (
    <SkeletonRegion label="Loading stream" className="flex h-full flex-col lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-panel px-3 py-4">
              <Skeleton className="h-[72px] w-[72px] rounded-full" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
      <div className="hidden w-[360px] shrink-0 border-l border-border bg-panel lg:block">
        <MessageListSkeleton />
      </div>
    </SkeletonRegion>
  );
}
