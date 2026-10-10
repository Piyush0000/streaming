/**
 * Detects social-app embedded browsers (Instagram, Facebook, TikTok, ...). Google blocks its
 * sign-in inside those web views ("disallowed_useragent"), so the login page tells the user to
 * open the page in their real browser instead.
 */
const IN_APP = /(FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|BytedanceWebview|Twitter|LinkedInApp|Pinterest|GSA\/)/i;

export function isInAppBrowser(ua: string): boolean {
  return IN_APP.test(ua);
}

export function isAndroid(ua: string): boolean {
  return /Android/i.test(ua);
}

/** Android intent URL that asks the OS to open this page in Chrome (works from most in-app browsers). */
export function chromeIntentUrl(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.slice(0, -1)};package=com.android.chrome;end`;
  } catch {
    return null;
  }
}
