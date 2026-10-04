import { Mic, MicOff } from 'lucide-react';

/** Mic icon that morphs (scale + rotate crossfade) between on and muted. */
export default function MicIcon({ muted, size = 16, className }: { muted: boolean; size?: number; className?: string }) {
  return (
    <span className={`icon-morph ${className ?? ''}`} style={{ width: size, height: size }} aria-hidden>
      <span data-on={!muted} className="flex items-center justify-center">
        <Mic size={size} />
      </span>
      <span data-on={muted} className="flex items-center justify-center">
        <MicOff size={size} />
      </span>
    </span>
  );
}
