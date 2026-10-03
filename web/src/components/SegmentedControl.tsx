import { ReactNode, useId } from 'react';
import { cx } from '../lib/format';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * Accessible segmented choice built on native radio inputs, so arrow keys,
 * focus and screen-reader semantics come for free.
 */
export default function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <label
            key={o.value}
            className={cx(
              'flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-accent',
              checked ? 'border-accent bg-accent-soft text-text-primary' : 'border-border bg-base text-text-secondary hover:bg-hover',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
