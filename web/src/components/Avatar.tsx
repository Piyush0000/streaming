import { colorForName, initials } from '../lib/format';
import { cx } from '../lib/format';

export default function Avatar({
  name,
  size = 36,
  ring = false,
  className,
}: {
  name: string;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        ring && 'ring-2 ring-success ring-offset-2 ring-offset-panel',
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.38),
        backgroundColor: colorForName(name),
      }}
      title={name}
    >
      {initials(name)}
    </div>
  );
}
