// First-touch acquisition source capture. Pure classification + defensive storage.

export const JOIN_SOURCES = ['x', 'facebook', 'instagram', 'youtube', 'reddit', 'telegram', 'whatsapp', 'google', 'direct', 'other'] as const;
export type JoinSource = (typeof JOIN_SOURCES)[number];

const HOST_RULES: Array<[JoinSource, string[]]> = [
  ['x', ['x.com', 'twitter.com', 't.co']],
  ['facebook', ['facebook.com', 'fb.com', 'fb.me', 'fb.watch']],
  ['instagram', ['instagram.com', 'instagr.am']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['reddit', ['reddit.com', 'redd.it']],
  ['telegram', ['t.me', 'telegram.org', 'telegram.me']],
  ['whatsapp', ['whatsapp.com', 'wa.me']],
  ['google', ['google.com']],
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain);
}

/** Maps a hostname (e.g. "l.instagram.com") to a source, or null if unrecognised. */
export function sourceFromHost(rawHost: string): JoinSource | null {
  const host = rawHost.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  for (const [src, domains] of HOST_RULES) {
    if (domains.some((d) => hostMatches(host, d))) return src;
  }
  // google.<tld> (google.co.in, google.de, ...)
  if (/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)) return 'google';
  return null;
}

/** Maps a free-form utm_source / ref / src value ("Instagram", "twitter", "ig", "fb.com"). */
export function sourceFromTag(raw: string): JoinSource | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  const alias: Record<string, JoinSource> = {
    x: 'x', twitter: 'x', tw: 'x',
    facebook: 'facebook', fb: 'facebook', meta: 'facebook',
    instagram: 'instagram', ig: 'instagram',
    youtube: 'youtube', yt: 'youtube',
    reddit: 'reddit',
    telegram: 'telegram', tg: 'telegram',
    whatsapp: 'whatsapp', wa: 'whatsapp',
    google: 'google',
    direct: 'direct',
  };
  if (alias[v]) return alias[v];
  return sourceFromHost(v);
}

/** In-app browsers frequently strip the referrer; their user agent still names the app. */
export function sourceFromUserAgent(ua: string): JoinSource | null {
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'facebook';
  if (/Twitter/i.test(ua)) return 'x';
  return null;
}

export interface SourceSignals {
  search?: string;
  referrer?: string;
  userAgent?: string;
  /** The app's own hostname; same-site referrers are ignored. */
  ownHost?: string;
}

/** Pure: explicit query tag > referrer host > in-app user agent > direct. A foreign unknown referrer is 'other'. */
export function detectJoinSource(sig: SourceSignals): JoinSource {
  try {
    const params = new URLSearchParams(sig.search ?? '');
    for (const key of ['utm_source', 'ref', 'src']) {
      const v = params.get(key);
      if (v) {
        const s = sourceFromTag(v);
        return s ?? 'other';
      }
    }
  } catch {
    /* fall through */
  }
  let refHost = '';
  try {
    if (sig.referrer) refHost = new URL(sig.referrer).hostname;
  } catch {
    refHost = '';
  }
  if (refHost && !(sig.ownHost && hostMatches(refHost.toLowerCase(), sig.ownHost.toLowerCase()))) {
    const s = sourceFromHost(refHost);
    if (s) return s;
    const ua = sourceFromUserAgent(sig.userAgent ?? '');
    return ua ?? 'other';
  }
  return sourceFromUserAgent(sig.userAgent ?? '') ?? 'direct';
}

// ---- persistence (all storage access is try/catch) ----
const SOURCE_KEY = 'streaming.joinSource';
const SENT_KEY = 'streaming.joinSourceSent';

export interface StoredSource {
  source: JoinSource;
  at: string;
}

export function readStoredSource(): StoredSource | null {
  try {
    const raw = localStorage.getItem(SOURCE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredSource;
    return JOIN_SOURCES.includes(v.source) ? v : null;
  } catch {
    return null;
  }
}

/** Detects and stores the first-touch source. Never overwrites an existing value. */
export function captureJoinSource(): void {
  try {
    if (readStoredSource()) return;
    const source = detectJoinSource({
      search: window.location.search,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
      ownHost: window.location.hostname,
    });
    localStorage.setItem(SOURCE_KEY, JSON.stringify({ source, at: new Date().toISOString() }));
  } catch {
    /* storage unavailable; skip */
  }
}

export function joinSentFlag(): boolean {
  try {
    return localStorage.getItem(SENT_KEY) === '1';
  } catch {
    return true; // can't persist the flag: don't risk repeated posts
  }
}

export function markJoinSent(): void {
  try {
    localStorage.setItem(SENT_KEY, '1');
  } catch {
    /* ignore */
  }
}
