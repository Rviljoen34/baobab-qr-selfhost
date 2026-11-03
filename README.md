# Baobab QR self-host kit

Keep the QR codes on your own domain working without Baobab QR.

If you print codes on your own domain with Baobab QR, such as `qr.yourbusiness.com/7K2XQ9P`, that domain is yours. If Baobab QR ever closes, or you decide to leave, this kit lets you answer those codes yourself, from a free Cloudflare account, so the codes you've printed keep working.

There's nothing to do while Baobab QR is running your codes. Use the kit when you need it, and keep the steps below for that day.

## What it serves, and what it can't

The kit answers **Link**, **WhatsApp** and **App download** codes that are **Live**. An App download code sends iPhones and iPads to the App Store, Android phones to Google Play, and everyone else to its other link, as Baobab QR does.

It can't do everything Baobab QR does:

- **Contact cards and PDFs don't move by themselves.** The export holds a contact card's name, not its details, and a PDF's file name, not the file. You can still keep those codes working: see [Add a code by hand](#add-a-code-by-hand).
- **Codes on baobabqr.app and baobabcode.app can't move.** Only Baobab QR can point those domains anywhere. The Baobab Pledge covers them: if Baobab QR ever closes, they keep working for at least five years after.
- **Paused, blocked and checking codes stay behind.** The kit takes only codes that are Live.
- **No scan statistics.** The kit counts nothing and keeps no logs.
- **No safety checks.** Baobab QR checks every link before it goes live, and again later. With the kit, nobody checks your links but you: you're responsible for where your codes go.
- **No dashboard.** You change a code by editing a file and running one command (see [Afterwards](#afterwards)).

It keeps people's privacy: no cookies, no IP addresses, no logs.

## What you need

- A computer with [Node.js](https://nodejs.org/) 22.18 or later, and about an hour. If you've never typed commands in a terminal, ask someone who has to sit with you.
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up).
- Your domain's DNS on Cloudflare. If it's managed somewhere else today, step 2 moves it; Cloudflare's free plan is enough.
- Your codes export from Baobab QR (step 6). Export it as close as you can to the day you switch, so it has your latest links.

## Set it up

1. **Get the kit.** On the kit's GitHub page, press **Code**, then **Download ZIP**, and unzip it. Open a terminal in the kit's folder and run:

   ```sh
   npm install
   ```

2. **Put your domain on Cloudflare**, if it isn't there yet. In Cloudflare's dashboard, add your domain (not the `qr.` part, just `yourbusiness.com`) and choose the Free plan. Cloudflare copies your domain's DNS records: check that all of them are there, and add any that are missing, copying them from where your DNS is managed today. Look especially at those for your website, your email (the MX records, and the TXT records email depends on, such as SPF and DKIM) and your codes (the CNAME record pointing to `customers.baobabqr.app`, which must stay **DNS only**, grey cloud, so your codes keep working with Baobab QR until step 9). If DNSSEC is on where you bought your domain, turn it off there first: changing nameservers with DNSSEC on can make your whole domain unreachable, website and email included. Then, where you bought your domain, change its nameservers to the two Cloudflare gives you, and wait until Cloudflare says the domain is **Active**. Once it is, you can turn DNSSEC on again in Cloudflare. Cloudflare's guide: [Primary setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/). If your domain is already on Cloudflare, skip this step.

3. **Let Wrangler, Cloudflare's tool, use your account.** It opens your browser to sign in:

   ```sh
   npx wrangler login
   ```

4. **Make a place for your codes**, a KV namespace:

   ```sh
   npx wrangler kv namespace create qr-codes --binding CODES
   ```

   Wrangler writes the new namespace's id into `wrangler.jsonc`. Open that file and check that the `id` under `kv_namespaces` is no longer `paste-your-namespace-id-here`. If it is, copy the id Wrangler printed into it.

5. **Name your domain.** In `wrangler.jsonc`, change `qr.yourbusiness.com` to the domain printed on your codes, and save the file.

6. **Export your codes from Baobab QR.** In Baobab QR, go to **Settings** and press **Export my codes**. Save `baobab-qr-codes.csv` in the kit's folder. Don't open and save it in a spreadsheet first: use it as it downloads.

7. **Import them.** Put your own domain after `--host`:

   ```sh
   node src/import.ts baobab-qr-codes.csv codes.json --host qr.yourbusiness.com
   ```

   It writes `codes.json` and says what it took and what it left out, for example:

   ```text
   Imported 3 codes into codes.json.
   Skipped 3 codes:
   - Contact cards (the export doesn't hold their details): 1
   - Paused (only live codes are taken): 1
   - On baobabqr.app, not qr.yourbusiness.com: 1
   Next, put them in your KV namespace: npx wrangler kv bulk put codes.json --binding CODES --remote
   ```

   To try the kit on your computer first, run `npx wrangler kv bulk put codes.json --binding CODES --local`, then `npm start`, and open `http://localhost:8787/` followed by one of your codes' 7 characters. Press Ctrl+C to stop it.

8. **Upload them to Cloudflare.** Keep `--remote`: without it, Wrangler writes only to a copy on your computer.

   ```sh
   npx wrangler kv bulk put codes.json --binding CODES --remote
   ```

9. **Switch your domain over.** While Baobab QR still serves your domain, Cloudflare sends its scans to Baobab QR, whatever your own DNS records say, so hand it back first. Do the three parts one straight after the other, at a quiet time: your codes don't answer in between, and phones that look while they don't may keep failing for up to half an hour.
   1. In Baobab QR, go to **Settings**, then **Your own domain**, press **Remove** and then **Remove anyway**. Your codes stop answering with Baobab QR. (If Baobab QR has closed, it has handed your domain back already.)
   2. In Cloudflare's dashboard, open your domain, then **DNS**, **Records**, and delete the CNAME record for your codes' domain (the one that points to `customers.baobabqr.app`). Cloudflare can't attach a Worker to a name that has a CNAME record.
   3. Run:

      ```sh
      npx wrangler deploy
      ```

      Cloudflare makes the DNS record and the certificate for your domain. The first scans may take a few minutes to work.

10. **Check it.** Open one of your codes' addresses in a browser, such as `https://qr.yourbusiness.com/7K2XQ9P`, and scan a printed code with your phone.

Keep the kit's folder, with `codes.json`: it's how you change your codes from now on. It also holds your links, so don't share it.

## Afterwards

**Change where a code goes.** Open `codes.json`, find the code by its 7 characters (`"key": "c:7K2XQ9P"`), change the address inside its `value`, and save the file, so it stays your record. Then put just that code: copy its whole entry, from `{` to `}`, without the comma after it, into a new file called `one.json` between square brackets, as below, and upload that file. It works the same on every computer.

```json
[{ "key": "c:7K2XQ9P", "value": "{\"d\":\"https://yourbusiness.com/new-menu\"}" }]
```

```sh
npx wrangler kv bulk put one.json --binding CODES --remote
```

Scanners see the change within a minute or two. Running step 8's command again works too, but it writes every code in the file, and the free plan allows 1,000 writes a day.

In `value`, `d` is where the code goes. An App download code also has `i`, its App Store link, and `g`, its Google Play link.

**Stop a code.** Remove its entry from `codes.json` (or step 8 would bring it back), then run this with the code's 7 characters; people who scan it then see "We can't find this QR code":

```sh
npx wrangler kv key delete c:7K2XQ9P --binding CODES --remote
```

### More than one domain

The kit can answer several of your domains at once. Run step 7 once for each, with its own `--host` and its own file (such as `codes-shop.json`), run step 8 for each file, and add a `routes` entry for each domain in `wrangler.jsonc` before step 9. Then do step 9's first two parts for each domain before you deploy. Codes never clash: every code's 7 characters are its own.

### Add a code by hand

For a contact card or a PDF, put a contact page or the file on your own website first. Then add an entry to `codes.json`, inside its square brackets, with the code's 7 characters (from the export's **Short address**) and the address of the page or file. Put a comma between it and the entry before it. Then upload just that entry, as **Change where a code goes** shows, with `one.json`.

```json
{ "key": "c:4M8TD2C", "value": "{\"d\":\"https://yourbusiness.com/menu.pdf\"}" }
```

### Cloudflare's free plan

On Cloudflare's free plan, Workers answer up to 100,000 requests a day and KV gives up to 100,000 reads a day. Each scan uses one of each. Over that, scans fail until midnight UTC; Cloudflare's paid Workers plan removes the limit. The free plan also allows 1,000 KV writes a day, which is enough for an export of 1,000 codes.

## How the kit works

`src/worker.ts` is the Worker: about a hundred lines, with no dependencies. For a request such as `/7K2XQ9P` it reads the KV key `c:7K2XQ9P` and sends the visitor on with a temporary redirect (302), so a code can always be changed. A code's 7 characters are read in upper case, with I and L read as 1 and O as 0, as Baobab QR reads them. An unknown code gets a small "We can't find this QR code" page, and `/robots.txt` keeps crawlers out.

`src/import.ts` is the importer, and `src/read-export.ts` reads the export for it. Run the tests with `npm test`.

`wrangler.jsonc` turns off the `workers.dev` address and the preview addresses, so your codes answer only on your domain, and turns off Workers logs, which would record the IP address of everyone who scans a code.

## Checked against Cloudflare's documentation

The commands and settings here were checked on 2 November 2026 against Cloudflare's documentation and Wrangler 4.155.0:

- [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/general/): `login`.
- [Wrangler KV commands](https://developers.cloudflare.com/kv/reference/kv-commands/): `kv namespace create` with `--binding`, `kv bulk put` and `kv key delete`, each with `--remote`. Wrangler 4.155.0 itself showed the rest: without `--remote` these commands use a copy on your computer, `kv namespace create` with `--binding` writes the id into `wrangler.jsonc`, and `kv bulk put` takes a list of `key` and `value` pairs.
- [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/): the `routes` entry with `custom_domain`, the active Cloudflare zone it needs, and that it can't be added on a name with a CNAME record.
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/): `workers_dev`, `preview_urls` and `observability`, whose logs are on for new Workers unless turned off.
- [DNS setups](https://developers.cloudflare.com/dns/zone-setups/): on the Free plan, a domain's DNS must be managed by Cloudflare.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [KV limits](https://developers.cloudflare.com/kv/platform/limits/): the free plan's requests, reads and writes a day.
- [Node.js TypeScript support](https://nodejs.org/api/typescript.html): Node.js runs `src/import.ts` as it is from version 22.18.

## Licence

MIT: anyone may use, copy and change this kit, keeping the copyright line. See `LICENSE`.
