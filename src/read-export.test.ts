import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCsv, readExport, summarise } from './read-export.ts';

// The importer, against a codes export as Baobab QR writes it (Settings, Export my codes): UTF-8 with a byte-order
// mark, rows ending with CRLF, quoted cells, and an apostrophe before a cell a spreadsheet could read as a formula.

const HOST = 'qr.yourbusiness.com';
const IOS = 'https://apps.apple.com/app/id123456789';
const ANDROID = 'https://play.google.com/store/apps/details?id=com.example.app';

const EXPORT =
  '\ufeff' +
  [
    'Short address,Name,Type,Destination or file name,Status,Created date,Total scans',
    `${HOST}/7K2XQ9P,"'=Menu, ""main""",Link,"https://example.com/menu?items=a,b",Live,2026-11-01,12`,
    `${HOST}/4M8TD2C,'@bookings,WhatsApp,https://wa.me/27821234567?text=Hello,Live,2026-11-01,3`,
    `${HOST}/APP1234,Our app,App download,App Store: ${IOS}; Google Play: ${ANDROID}; Everyone else: https://example.com/app,Live,2026-11-01,0`,
    `${HOST}/GP10000,"Two
lines",App download,Google Play: ${ANDROID}; Everyone else: https://example.com/android,Live,2026-11-02,0`,
    `${HOST}/CARD123,Jane Smith,Contact card,Jane Smith,Live,2026-11-02,1`,
    `${HOST}/F11E123,Menu file,PDF,menu.pdf,Live,2026-11-02,0`,
    `${HOST}/P000001,Old menu,Link,https://example.com/old,Paused,2026-11-02,0`,
    `${HOST}/C000001,New menu,Link,https://example.com/new,Checking,2026-11-02,0`,
    `${HOST}/B000001,Bad link,Link,https://example.com/bad,Blocked,2026-11-02,0`,
    'baobabqr.app/7K2XQ9Q,Paid domain,Link,https://example.com/paid,Live,2026-11-02,0',
    'baobabcode.app/4M8TD2D,Free domain,Link,https://example.com/free,Live,2026-11-02,0',
  ].join('\r\n') +
  '\r\n';

const IMPORTED = [
  { key: 'c:7K2XQ9P', value: '{"d":"https://example.com/menu?items=a,b"}' },
  { key: 'c:4M8TD2C', value: '{"d":"https://wa.me/27821234567?text=Hello"}' },
  { key: 'c:APP1234', value: `{"d":"https://example.com/app","i":"${IOS}","g":"${ANDROID}"}` },
  { key: 'c:GP10000', value: `{"d":"https://example.com/android","g":"${ANDROID}"}` },
];

const SKIPPED = [
  ["Contact cards (the export doesn't hold their details)", 1],
  ["PDFs (the export doesn't hold the files)", 1],
  ['Paused (only live codes are taken)', 1],
  ['Checking (only live codes are taken)', 1],
  ['Blocked (only live codes are taken)', 1],
  ['On baobabqr.app, not qr.yourbusiness.com', 1],
  ['On baobabcode.app, not qr.yourbusiness.com', 1],
];

describe('reading the codes export', () => {
  it('reads quoted cells, doubled quotes, line breaks in a cell and the byte-order mark', () => {
    const rows = parseCsv(EXPORT);
    expect(rows[0]?.[0]).toBe('Short address');
    expect(rows[1]).toEqual([
      `${HOST}/7K2XQ9P`,
      `'=Menu, "main"`,
      'Link',
      'https://example.com/menu?items=a,b',
      'Live',
      '2026-11-01',
      '12',
    ]);
    expect(rows[4]?.[1]).toBe('Two\nlines');
    expect(rows).toHaveLength(12);
    expect(parseCsv('a,"b\r\nc",d')).toEqual([['a', 'b\r\nc', 'd']]);
    expect(parseCsv('a,\r\n,b\n')).toEqual([
      ['a', ''],
      ['', 'b'],
    ]);
  });

  it("takes the live link, WhatsApp and App download codes on the customer's domain, and says why it left out the rest", () => {
    const result = readExport(EXPORT, HOST);
    expect(result.pairs).toEqual(IMPORTED);
    expect([...result.skipped]).toEqual(SKIPPED);
    for (const { value } of result.pairs) expect(JSON.parse(value)).toHaveProperty('d');
  });

  it('reads the file the same once a spreadsheet has saved it without the mark or the CRs', () => {
    const resaved = EXPORT.replace('\ufeff', '').replaceAll('\r\n', '\n');
    expect(readExport(resaved, HOST)).toEqual(readExport(EXPORT, HOST));
  });

  it('finds its columns by name, so a new column or another order changes nothing', () => {
    const rows = parseCsv(EXPORT).map(([address, name, type, where, status, created, scans]) =>
      [scans, 'Folder', status, where, type, name, address, created].map((cell) => `"${cell!.replaceAll('"', '""')}"`),
    );
    expect(readExport(rows.map((row) => row.join(',')).join('\r\n'), HOST)).toEqual(readExport(EXPORT, HOST));
  });

  it('takes the domain however it is typed', () => {
    for (const host of ['QR.YourBusiness.com', 'https://qr.yourbusiness.com/', 'qr.yourbusiness.com.']) {
      expect(readExport(EXPORT, host).pairs, host).toEqual(IMPORTED);
    }
    // Codes on Baobab QR's own domains stay with Baobab QR: only Baobab QR can point those domains anywhere.
    for (const ours of ['baobabqr.app', 'https://baobabcode.app/', 'staging.baobabqr.app']) {
      expect(() => readExport(EXPORT, ours), ours).toThrow("is Baobab QR's own domain");
    }
  });

  it("leaves out rows it can't use, and refuses a file that isn't the export", () => {
    const odd = [
      'Short address,Name,Type,Destination or file name,Status',
      `${HOST}/TOOSHORT,A,Link,https://example.com/a,Live`,
      `${HOST}/7K2XQ9P,B,Link,http://example.com/b,Live`,
      `${HOST}/7K2XQ9R,C,App download,Google Play: ${ANDROID},Live`,
      `${HOST}/7K2XQ9S,D,Event,https://example.com/d,Live`,
      '',
    ].join('\r\n');
    expect(readExport(odd, HOST)).toEqual({
      pairs: [],
      skipped: new Map([
        ["Short addresses we can't read", 1],
        ['No https link to send people to', 1],
        ["App download links we can't read", 1],
        ['Event (not a type the kit serves)', 1],
      ]),
    });
    expect(() => readExport('Name,Link\r\nMenu,https://example.com/\r\n', HOST)).toThrow(
      "This doesn't look like Baobab QR's codes export: its first row needs the columns Short address, Type, Destination or file name, Status.",
    );
  });

  it('sums up what it did', () => {
    expect(summarise(readExport(EXPORT, HOST), 'codes.json')).toEqual([
      'Imported 4 codes into codes.json.',
      'Skipped 7 codes:',
      ...SKIPPED.map(([reason, count]) => `- ${reason}: ${count}`),
      'Next, put them in your KV namespace: npx wrangler kv bulk put codes.json --binding CODES --remote',
    ]);
    expect(summarise(readExport(EXPORT, 'qr.other.com'), 'codes.json')).toEqual([
      'Imported 0 codes into codes.json.',
      'Skipped 11 codes:',
      '- On qr.yourbusiness.com, not qr.other.com: 9',
      '- On baobabqr.app, not qr.other.com: 1',
      '- On baobabcode.app, not qr.other.com: 1',
      'Nothing to put in your KV namespace. Check that --host is the domain printed on your codes.',
    ]);
  });
});

describe('the importer, run with Node.js', () => {
  const script = fileURLToPath(new URL('import.ts', import.meta.url));
  const folder = mkdtempSync(join(tmpdir(), 'selfhost-'));
  const csv = join(folder, 'baobab-qr-codes.csv');
  const json = join(folder, 'codes.json');
  writeFileSync(csv, EXPORT);
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('writes the file wrangler kv bulk put takes, and prints the summary', () => {
    const printed = execFileSync(process.execPath, [script, csv, json, '--host', HOST], { encoding: 'utf8' });
    expect(JSON.parse(readFileSync(json, 'utf8'))).toEqual(IMPORTED);
    expect(printed).toBe(`${summarise(readExport(EXPORT, HOST), json).join('\n')}\n`);
    execFileSync(process.execPath, [script, `--host=${HOST}`, csv, json]);
  });

  it('explains how to run it, or what went wrong, and fails', () => {
    for (const args of [
      [csv, json],
      [csv, '--host', HOST],
      [join(folder, 'missing.csv'), json, '--host', HOST],
    ]) {
      const run = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
      expect(run.status, args.join(' ')).toBe(1);
      expect(run.stderr).toMatch(/^(Usage: node src\/import\.ts |Can't open )/);
    }
  });
});
