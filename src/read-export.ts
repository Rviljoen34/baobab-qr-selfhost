// Reads Baobab QR's codes export (Settings, Export my codes: baobab-qr-codes.csv) into the keys and values the kit's
// Worker reads, as the JSON file `wrangler kv bulk put` takes: [{"key": "c:<SHORT_ID>", "value": "<JSON>"}].
//
// Only codes the kit can answer are taken: Link, WhatsApp and App download codes that are Live, on the domain you
// name. A contact card or a PDF needs what the export doesn't hold (the contact's details, the file), and codes on
// Baobab QR's own domains can't move, as only Baobab QR can point those domains anywhere.

type Pair = { key: string; value: string };

// What was read: the pairs, and how many codes were left out for each reason.
export type Result = { pairs: Pair[]; skipped: Map<string, number> };

// The columns this reads, by the names in the export's first row. The export has others, which don't matter here.
const COLUMNS = {
  address: 'Short address',
  type: 'Type',
  where: 'Destination or file name',
  status: 'Status',
} as const;

// An App download code's "Destination or file name": "App Store: <link>; Google Play: <link>; Everyone else: <link>",
// each part there only when the code has that link.
const APP_LINKS = new Map([
  ['App Store', 'i'],
  ['Google Play', 'g'],
  ['Everyone else', 'd'],
]);

const SHORT_ID = /^[0-9A-HJKMNP-TV-Z]{7}$/;
const normaliseShortId = (raw: string) => raw.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');
const isHttps = (value: string | undefined): value is string => Boolean(value && /^https:\/\/\S+$/i.test(value));

// The export's CSV: UTF-8 with a byte-order mark, cells quoted when they hold a comma, a quote or a line break (a
// quote inside one doubled), rows ending with CRLF. A file saved again elsewhere may lose the mark or end its rows
// with LF only, which reads the same.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let at = text.startsWith('\ufeff') ? 1 : 0; at < text.length; at += 1) {
    const char = text[at]!;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[at + 1] === '"') {
        cell += '"';
        at += 1;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[at + 1] === '\n') at += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell || row.length > 0) rows.push([...row, cell]);
  return rows;
}

// The export puts an apostrophe before a cell that starts with = + - @, a tab or a carriage return, so a spreadsheet
// never reads it as a formula. This takes it away again.
const unescapeCell = (cell: string) => (/^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell);

// A domain as typed: in lower case, without https://, a path, a port or a final dot.
function hostOf(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .split('/')[0] ?? ''
  )
    .replace(/:\d*$/, '')
    .replace(/\.$/, '');
}

// "qr.yourbusiness.com/7K2XQ9P" (or with https:// in front) as its domain and short id; null when it isn't one.
function readAddress(address: string): { host: string; id: string } | null {
  const text = address.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const slash = text.indexOf('/');
  const id = normaliseShortId(text.slice(slash + 1));
  return slash > 0 && SHORT_ID.test(id) ? { host: hostOf(text.slice(0, slash)), id } : null;
}

// The value the Worker reads for a code, or why the code can't be taken.
function valueFor(type: string, where: string): { value: Record<string, string> } | { reason: string } {
  if (type === 'Contact card') return { reason: "Contact cards (the export doesn't hold their details)" };
  if (type === 'PDF') return { reason: "PDFs (the export doesn't hold the files)" };
  if (type === 'Link' || type === 'WhatsApp') {
    return isHttps(where) ? { value: { d: where } } : { reason: 'No https link to send people to' };
  }
  if (type === 'App download') {
    const links: Record<string, string> = {};
    for (const part of where.split('; ')) {
      const colon = part.indexOf(': ');
      const key = APP_LINKS.get(part.slice(0, colon));
      const link = part.slice(colon + 2);
      if (colon < 0 || !key || !isHttps(link)) return { reason: "App download links we can't read" };
      links[key] = link;
    }
    if (!links.d) return { reason: "App download links we can't read" };
    return { value: { d: links.d, ...(links.i && { i: links.i }), ...(links.g && { g: links.g }) } };
  }
  return { reason: `${type || 'No type'} (not a type the kit serves)` };
}

// Codes on Baobab QR's own short domains can't be self-hosted: only Baobab QR can point those domains anywhere.
const BAOBAB_DOMAINS = ['baobabqr.app', 'baobabcode.app', 'baobabqr.com'];

export function readExport(csv: string, host: string): Result {
  const domain = hostOf(host);
  if (BAOBAB_DOMAINS.some((ours) => domain === ours || domain.endsWith(`.${ours}`))) {
    throw new Error(
      `${domain} is Baobab QR's own domain, which only Baobab QR can point anywhere. Use --host with your own domain, as printed on your codes, such as qr.yourbusiness.com.`,
    );
  }
  const [header = [], ...rows] = parseCsv(csv).filter((row) => row.some((cell) => cell.trim()));
  const column = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, name]) => [key, header.map((cell) => cell.trim()).indexOf(name)]),
  ) as Record<keyof typeof COLUMNS, number>;
  if (Object.values(column).some((index) => index < 0)) {
    throw new Error(
      `This doesn't look like Baobab QR's codes export: its first row needs the columns ${Object.values(COLUMNS).join(', ')}.`,
    );
  }

  const pairs = new Map<string, string>();
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  for (const row of rows) {
    const cell = (key: keyof typeof COLUMNS) => unescapeCell(row[column[key]] ?? '').trim();
    const address = readAddress(cell('address'));
    const status = cell('status');
    const found = valueFor(cell('type'), cell('where'));
    if (!address) skip("Short addresses we can't read");
    else if (address.host !== domain) skip(`On ${address.host}, not ${domain}`);
    else if ('reason' in found) skip(found.reason);
    else if (status !== 'Live') skip(`${status || 'No status'} (only live codes are taken)`);
    else pairs.set(`c:${address.id}`, JSON.stringify(found.value));
  }
  return { pairs: [...pairs].map(([key, value]) => ({ key, value })), skipped };
}

const codes = (count: number) => `${count} ${count === 1 ? 'code' : 'codes'}`;

// What the importer prints: how many codes it took, and how many it left out and why.
export function summarise({ pairs, skipped }: Result, file: string): string[] {
  const lines = [`Imported ${codes(pairs.length)} into ${file}.`];
  const left = [...skipped.values()].reduce((sum, count) => sum + count, 0);
  if (left > 0) {
    lines.push(`Skipped ${codes(left)}:`, ...[...skipped].map(([reason, count]) => `- ${reason}: ${count}`));
  }
  lines.push(
    pairs.length > 0
      ? `Next, put them in your KV namespace: npx wrangler kv bulk put ${file} --binding CODES --remote`
      : 'Nothing to put in your KV namespace. Check that --host is the domain printed on your codes.',
  );
  return lines;
}
