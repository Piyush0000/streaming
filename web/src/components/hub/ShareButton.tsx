import { useRef, useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { shareLink, shareToastMessage } from '../../lib/share';
import { useToast } from '../../context/ToastContext';
import { cx } from '../../lib/format';

/**
 * Share button with visible feedback: native share sheet on phones, clipboard elsewhere, and a
 * toast with the raw link when both fail (some in-app browsers block both).
 * `url` may be a path ("/elonixhub/c/x") or absolute; paths are resolved against this origin.
 */
export default function ShareButton({
  url,
  title,
  text,
  label = 'Share',
  className,
  iconSize = 15,
  showLabel = true,
}: {
  url: string;
  title?: string;
  text?: string;
  label?: string;
  className?: string;
  iconSize?: number;
  /** false = icon only on every width (label stays as aria-label). */
  showLabel?: boolean;
}) {
  const { showToast } = useToast();
  const [done, setDone] = useState(false);
  const busy = useRef(false);

  async function onClick() {
    if (busy.current) return;
    busy.current = true;
    try {
      const abs = /^https?:\/\//i.test(url) ? url : `${window.location.origin}${url}`;
      const result = await shareLink({ url: abs, title, text });
      const toast = shareToastMessage(result, abs);
      if (toast) showToast(toast.message, toast.kind);
      if (result === 'shared' || result === 'copied') {
        setDone(true);
        window.setTimeout(() => setDone(false), 1800);
      }
    } finally {
      busy.current = false;
    }
  }

  return (
    <button type="button" onClick={() => void onClick()} aria-label={label} className={cx('tap', className)}>
      {done ? <Check size={iconSize} className="text-success" aria-hidden /> : <Share2 size={iconSize} aria-hidden />}
      {showLabel && <span className="hidden sm:inline">{done ? 'Copied' : label}</span>}
    </button>
  );
}
