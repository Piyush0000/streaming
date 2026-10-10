import { copyText } from './clipboard';

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Shares a link the way each device expects: the native share sheet on phones
 * (WhatsApp, Instagram, X, ...), clipboard copy on desktop, and a last-resort
 * result the caller can surface (so the user can still copy the URL by hand).
 */
export async function shareLink(opts: { url: string; title?: string; text?: string }): Promise<ShareResult> {
  const { url, title, text } = opts;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      const data: ShareData = { url, title, text };
      if (!navigator.canShare || navigator.canShare(data)) {
        await navigator.share(data);
        return 'shared';
      }
    }
  } catch (err) {
    // The user closing the sheet is not an error; anything else falls back to copying.
    if ((err as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
  }
  return (await copyText(url)) ? 'copied' : 'failed';
}

export function shareToastMessage(result: ShareResult, url: string): { message: string; kind: 'success' | 'info' | 'error' } | null {
  switch (result) {
    case 'shared':
      return { message: 'Shared', kind: 'success' };
    case 'copied':
      return { message: 'Link copied to clipboard', kind: 'success' };
    case 'cancelled':
      return null;
    default:
      return { message: `Copy this link: ${url}`, kind: 'info' };
  }
}
