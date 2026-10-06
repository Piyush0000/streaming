/** Odometer-style number: each digit is a vertical strip that rolls to its value. Real values only. */
export default function Odometer({ value, className = '' }: { value: number; className?: string }) {
  const safe = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  const digits = String(safe).split('');
  return (
    <span className={`odo ${className}`} role="text" aria-label={String(safe)}>
      {digits.map((d, i) => (
        // Keyed by position from the right so existing digits keep their column (and animate) when the count grows.
        <span key={digits.length - i} className="odo-col" aria-hidden>
          <span className="odo-strip" style={{ transform: `translateY(-${Number(d)}em)` }}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <span key={n}>{n}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}
