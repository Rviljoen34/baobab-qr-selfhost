// The importer: node src/import.ts <export.csv> <out.json> --host <your domain>
// It reads Baobab QR's codes export and writes the codes your domain serves as a JSON file for
// `wrangler kv bulk put`, then says how many it took and what it left out (README.md, step 6).

import { readFileSync, writeFileSync } from 'node:fs';
import { readExport, summarise } from './read-export.ts';

const USAGE =
  'Usage: node src/import.ts baobab-qr-codes.csv codes.json --host qr.yourbusiness.com\n' +
  'where --host is the domain printed on your codes.';

function run(args: string[]): number {
  const files: string[] = [];
  let host = '';
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg === '--host') {
      host = args[at + 1] ?? '';
      at += 1;
    } else if (arg.startsWith('--host=')) host = arg.slice('--host='.length);
    else files.push(arg);
  }
  const [input, output] = files;
  if (!input || !output || files.length > 2 || !host.trim()) {
    console.error(USAGE);
    return 1;
  }

  let csv: string;
  try {
    csv = readFileSync(input, 'utf8');
  } catch {
    console.error(`Can't open ${input}. Check the file's name, and that it's in this folder.`);
    return 1;
  }
  try {
    const result = readExport(csv, host);
    writeFileSync(output, `${JSON.stringify(result.pairs, null, 2)}\n`);
    console.log(summarise(result, output).join('\n'));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = run(process.argv.slice(2));
