import { cx } from '../lib/format';

/** Three bouncing dots for "connecting / typing" states. */
export default function Dots({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx('inline-flex items-center gap-[3px]', className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 animate-dot-bounce rounded-full bg-current"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}
