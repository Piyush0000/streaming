import { ReactNode } from 'react';
import { useReveal } from '../hooks/useReveal';
import { cx } from '../lib/format';

/** Wrapper that reveals its children on scroll. `delay` (ms) staggers siblings. */
export default function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useReveal<HTMLDivElement>(delay);
  return (
    <div ref={ref} className={cx('reveal', className)}>
      {children}
    </div>
  );
}
