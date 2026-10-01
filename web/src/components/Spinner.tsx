import { Loader2 } from 'lucide-react';
import { cx } from '../lib/format';

export default function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx('animate-spin text-text-secondary', className)} />;
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-text-secondary">
      <Spinner size={28} />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}
