/**
 * Resolve the website's visitor/session identity from the browser, so a
 * booking can be joined to `website_events` and `website_leads`.
 *
 * Three sources, in priority order. The order matters more than it looks:
 *
 *   1. ?vid= / ?sid= query parameters.
 *      The ONLY option that survives a cross-domain hop. If the site is
 *      anyhealth.asia and the scheduler is on *.vercel.app, cookies and
 *      localStorage are a different origin entirely and carry nothing — the
 *      link silently produces NULLs. Passing the id on the "Book a call" URL
 *      is what makes attribution work in that setup.
 *   2. Cookie. Works when both live on the same registrable domain, e.g. the
 *      site on anyhealth.asia and the scheduler on book.anyhealth.asia, with
 *      the tracker setting Domain=.anyhealth.asia.
 *   3. localStorage / sessionStorage. Same-origin only.
 *
 * Whatever is found is written back to a cookie and localStorage, so the id
 * survives the rest of the booking flow.
 */

const VISITOR_KEYS = [
  process.env.NEXT_PUBLIC_VISITOR_COOKIE,
  'ah_vid',
  'visitor_id',
  'anyhealth_visitor_id',
  'ah_visitor',
].filter(Boolean) as string[];

const SESSION_KEYS = [
  process.env.NEXT_PUBLIC_SESSION_COOKIE,
  'ah_sid',
  'session_id',
  'anyhealth_session_id',
  'ah_session',
].filter(Boolean) as string[];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  // Share across subdomains when a parent domain is configured, so the id set
  // on the marketing site is visible on book.<domain>.
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN;
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'path=/',
    `max-age=${60 * 60 * 24 * 365}`,
    'SameSite=Lax',
    domain ? `domain=${domain}` : '',
    location.protocol === 'https:' ? 'Secure' : '',
  ].filter(Boolean);
  document.cookie = parts.join('; ');
}

function readStorage(store: Storage | undefined, keys: string[]): string | null {
  if (!store) return null;
  for (const key of keys) {
    try {
      const value = store.getItem(key);
      if (isUuid(value)) return value!.trim();
    } catch {
      return null; // private browsing / blocked storage
    }
  }
  return null;
}

function resolve(keys: string[], params: URLSearchParams, queryNames: string[]): string | null {
  for (const name of queryNames) {
    const fromQuery = params.get(name);
    if (isUuid(fromQuery)) return fromQuery!.trim();
  }
  for (const key of keys) {
    const fromCookie = readCookie(key);
    if (isUuid(fromCookie)) return fromCookie!.trim();
  }
  const local = readStorage(typeof window === 'undefined' ? undefined : window.localStorage, keys);
  if (local) return local;
  return readStorage(typeof window === 'undefined' ? undefined : window.sessionStorage, keys);
}

export interface VisitorContext {
  visitorId: string | null;
  sessionId: string | null;
  sourcePath: string | null;
  referrer: string | null;
  utm: Record<string, string>;
}

/** Call once, client-side, when the booking wizard mounts. */
export function getVisitorContext(): VisitorContext {
  if (typeof window === 'undefined') {
    return { visitorId: null, sessionId: null, sourcePath: null, referrer: null, utm: {} };
  }

  const params = new URLSearchParams(window.location.search);

  const visitorId = resolve(VISITOR_KEYS, params, ['vid', 'visitor_id']);
  const sessionId = resolve(SESSION_KEYS, params, ['sid', 'session_id']);

  // Persist so the id is still here after the wizard navigates.
  if (visitorId) {
    writeCookie(VISITOR_KEYS[0], visitorId);
    try {
      window.localStorage.setItem(VISITOR_KEYS[0], visitorId);
    } catch { /* blocked storage is fine */ }
  }
  if (sessionId) {
    writeCookie(SESSION_KEYS[0], sessionId);
  }

  const utm: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const value = params.get(key);
    if (value) utm[key] = value.slice(0, 200);
  }

  return {
    visitorId,
    sessionId,
    sourcePath: params.get('from') ?? safePath(document.referrer),
    referrer: document.referrer || null,
    utm,
  };
}

function safePath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}
