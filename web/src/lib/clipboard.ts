/** Copies text to the clipboard; falls back to a hidden textarea where the async API is unavailable (http, old browsers). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    el.style.left = '-9999px';
    el.style.fontSize = '16px'; // avoids the iOS focus-zoom
    document.body.appendChild(el);
    el.focus({ preventScroll: true });
    el.select();
    el.setSelectionRange(0, text.length); // iOS / in-app webviews ignore select() alone
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
