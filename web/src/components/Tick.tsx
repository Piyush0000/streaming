/** Number that plays a small slide-up whenever its value changes. */
export default function Tick({ value }: { value: number | string }) {
  return (
    <span key={String(value)} className="inline-block animate-tick tabular-nums">
      {value}
    </span>
  );
}
