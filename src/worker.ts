// The Baobab QR self-host kit's Worker: it answers the codes printed with your own domain, from your own Cloudflare
// account, so they keep working without Baobab QR. It reads one KV namespace, bound as CODES, where each code is a
// key `c:<SHORT_ID>` with a JSON value: {"d": "<where it goes>"}, and for an App download code also "i" (the App
// Store link, for iPhones and iPads) and "g" (the Google Play link, for Android phones). It sets no cookies, keeps no
// logs and counts nothing.

export type Env = {
  CODES: { get(key: string, options: { type: 'json'; cacheTtl?: number }): Promise<unknown> };
};

type Entry = { d?: unknown; i?: unknown; g?: unknown };

// A short id is 7 characters of Crockford base32. It's read in upper case, with I and L as 1 and O as 0, the letters
// Crockford base32 leaves out because they look alike.
const SHORT_ID = /^[0-9A-HJKMNP-TV-Z]{7}$/;
const normaliseShortId = (raw: string) => raw.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');

// An address typed by hand may hold a space or letters outside English: read as a URL, it's sent on encoded, as a
// browser would. Only an http or https address counts; anything else isn't one.
function webAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function device(userAgent: string): 'ios' | 'android' | 'other' {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'other';
}

// An App download code sends iPhones to the App Store and Android phones to Google Play; everyone else, and a phone
// whose store link is missing, goes to `d`.
function whereTo(entry: Entry, everyoneElse: string, userAgent: string): string {
  const kind = device(userAgent);
  const store = kind === 'ios' ? webAddress(entry.i) : kind === 'android' ? webAddress(entry.g) : null;
  return store ?? everyoneElse;
}

// No search engine or other crawler needs anything here.
const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

function page(status: number, heading: string, text: string): Response {
  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<style>body{margin:0;font-family:system-ui,sans-serif;line-height:1.5}main{max-width:32rem;margin:0 auto;padding:3rem 1.25rem}h1{font-size:1.5rem;line-height:1.25}</style>
</head>
<body>
<main>
<h1>${heading}</h1>
<p>${text}</p>
</main>
</body>
</html>
`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}

const problem = () =>
  page(503, 'Something went wrong', "This QR code can't be opened just now. Please try again in a minute.");

const notFound = () =>
  page(
    404,
    "We can't find this QR code",
    'Check that the whole code was scanned. If you typed the address, check it for typos.',
  );

async function answer(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const { pathname } = new URL(request.url);
  if (pathname === '/robots.txt') {
    return new Response(ROBOTS_TXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const id = normaliseShortId(pathname.match(/^\/([^/]+)$/)?.[1] ?? '');
  if (!SHORT_ID.test(id)) return notFound();

  let entry: Entry | null;
  try {
    // Cached for 60 seconds where it's read; with KV's own spread, a change reaches every scanner within a minute or two.
    entry = (await env.CODES.get(`c:${id}`, { type: 'json', cacheTtl: 60 })) as Entry | null;
  } catch {
    return problem();
  }
  if (!entry || entry.d === undefined) return notFound();
  // An address in codes.json that can't be read: say so, rather than send the scanner nowhere.
  const destination = webAddress(entry.d);
  if (!destination) return problem();

  const headers: Record<string, string> = {
    Location: whereTo(entry, destination, request.headers.get('user-agent') ?? ''),
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  };
  // An App download code's answer depends on the phone.
  if (entry.i || entry.g) headers.Vary = 'User-Agent';
  return new Response(null, { status: 302, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await answer(request, env);
    // A HEAD request gets the headers only. Nothing here belongs in search results.
    const headed = new Response(request.method === 'HEAD' ? null : response.body, response);
    headed.headers.set('X-Robots-Tag', 'noindex');
    return headed;
  },
};
