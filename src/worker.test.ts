import { describe, expect, it } from 'vitest';
import worker, { type Env } from './worker.ts';

// The Worker's answers, with a stand-in for the KV namespace that holds what the importer writes.

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const COMPUTER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const STORED: Record<string, string> = {
  'c:7K2XQ9P': '{"d":"https://example.com/menu?table=4"}',
  'c:4M8TD2C': '{"d":"https://wa.me/27821234567?text=Hello"}',
  'c:APP1234':
    '{"d":"https://example.com/app","i":"https://apps.apple.com/app/id123456789","g":"https://play.google.com/store/apps/details?id=com.example.app"}',
  'c:GP10000': '{"d":"https://example.com/app","g":"https://play.google.com/store/apps/details?id=com.example.app"}',
  'c:BAD1234': '{"d":"javascript:alert(1)"}',
  // Typed by hand into codes.json: a space and a letter outside English.
  'c:SPACE01': '{"d":"https://example.com/Our Menu.pdf"}',
  'c:CAFE123': '{"d":"https://café.example.com/menu"}',
};

const reads: { key: string; options: unknown }[] = [];
const env: Env = {
  CODES: {
    async get(key, options) {
      reads.push({ key, options });
      if (key === 'c:BR0KEN0') throw new Error('KV is down');
      const value = STORED[key];
      return value === undefined ? null : (JSON.parse(value) as unknown);
    },
  },
};

const scan = (path: string, init: RequestInit & { userAgent?: string } = {}) =>
  worker.fetch(
    new Request(`https://qr.yourbusiness.com${path}`, {
      ...init,
      headers: { 'user-agent': init.userAgent ?? IPHONE },
    }),
    env,
  );

describe('the self-host Worker', () => {
  it('sends a link code on with no cache, no referrer and noindex', async () => {
    const response = await scan('/7K2XQ9P');
    expect(response.status).toBe(302);
    expect(Object.fromEntries(response.headers)).toEqual({
      location: 'https://example.com/menu?table=4',
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
    });
    expect(await response.text()).toBe('');
    expect(reads.at(-1)).toEqual({ key: 'c:7K2XQ9P', options: { type: 'json', cacheTtl: 60 } });
  });

  it('reads an id typed in lower case, with I, L and O for 1, 1 and 0', async () => {
    expect((await scan('/7k2xq9p')).headers.get('location')).toBe('https://example.com/menu?table=4');
    expect((await scan('/4m8td2c')).headers.get('location')).toBe('https://wa.me/27821234567?text=Hello');
    expect((await scan('/APPl234')).status).toBe(302);
    expect((await scan('/gpi0000')).status).toBe(302);
    expect(reads.at(-1)?.key).toBe('c:GP10000');
    expect((await scan('/BRoKEN0')).status).toBe(503);
  });

  it('sends iPhones to the App Store, Android phones to Google Play and everyone else to the other link', async () => {
    for (const [userAgent, location] of [
      [IPHONE, 'https://apps.apple.com/app/id123456789'],
      [ANDROID, 'https://play.google.com/store/apps/details?id=com.example.app'],
      [COMPUTER, 'https://example.com/app'],
    ] as const) {
      const response = await scan('/APP1234', { userAgent });
      expect(response.status).toBe(302);
      expect(response.headers.get('location'), userAgent).toBe(location);
      expect(response.headers.get('vary')).toBe('User-Agent');
    }
    // A phone whose store link is missing goes to the other link.
    expect((await scan('/GP10000', { userAgent: IPHONE })).headers.get('location')).toBe('https://example.com/app');
    expect((await scan('/GP10000', { userAgent: ANDROID })).headers.get('location')).toBe(
      'https://play.google.com/store/apps/details?id=com.example.app',
    );
    // A link code's answer is the same for every phone.
    expect((await scan('/7K2XQ9P')).headers.has('vary')).toBe(false);
  });

  it('answers a HEAD request with the same headers and no body', async () => {
    const response = await scan('/7K2XQ9P', { method: 'HEAD' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://example.com/menu?table=4');
    const missing = await scan('/ZZZZZZZ', { method: 'HEAD' });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('');
  });

  it('sends an address typed by hand with a space or a letter outside English on, encoded as a browser would', async () => {
    expect((await scan('/SPACE01')).headers.get('location')).toBe('https://example.com/Our%20Menu.pdf');
    expect((await scan('/CAFE123')).headers.get('location')).toBe('https://xn--caf-dma.example.com/menu');
  });

  it('says a code whose address in codes.json isn’t a web address can’t be opened', async () => {
    const response = await scan('/BAD1234');
    expect(response.status).toBe(503);
    expect(response.headers.has('location')).toBe(false);
  });

  it('shows a small page for an unknown code or a bad address', async () => {
    for (const path of ['/ZZZZZZZ', '/', '/7K2XQ9', '/7K2XQ9PP', '/7K2XQ9P/', '/7K2XQ9P/contact.vcf']) {
      const response = await scan(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('x-robots-tag')).toBe('noindex');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.has('location')).toBe(false);
      expect(await response.text()).toContain("<h1>We can't find this QR code</h1>");
    }
  });

  it("says when the codes can't be read just now", async () => {
    const response = await scan('/BR0KEN0');
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("This QR code can't be opened just now.");
  });

  it('keeps every crawler out, and takes only GET and HEAD', async () => {
    const robots = await scan('/robots.txt');
    expect(robots.status).toBe(200);
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');
    const post = await scan('/7K2XQ9P', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('sets no cookies', async () => {
    for (const path of ['/7K2XQ9P', '/APP1234', '/ZZZZZZZ', '/robots.txt']) {
      expect((await scan(path)).headers.has('set-cookie')).toBe(false);
    }
  });
});
