import Avatar from './Avatar';

export interface StackPerson {
  key: string;
  name: string;
  src?: string | null;
  preset?: string | null;
}

/** Overlapping avatars with a "+N" chip for the overflow. Renders nothing for an empty list. */
export default function AvatarStack({
  people,
  max = 4,
  size = 24,
  label,
}: {
  people: StackPerson[];
  max?: number;
  size?: number;
  /** Accessible summary, e.g. "3 listening". */
  label?: string;
}) {
  if (!people || people.length === 0) return null;
  const shown = people.slice(0, Math.max(1, max));
  const extra = people.length - shown.length;
  return (
    <span className="avatar-stack inline-flex items-center" role="group" aria-label={label ?? `${people.length} people`}>
      {shown.map((p) => (
        <span key={p.key} className="rounded-full ring-2 ring-panel">
          <Avatar name={p.name} src={p.src ?? null} preset={p.preset} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="flex items-center justify-center rounded-full bg-hover text-[10px] font-semibold text-text-secondary ring-2 ring-panel"
          style={{ width: size, height: size }}
          title={`${extra} more`}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
