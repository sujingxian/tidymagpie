# Tidy Magpie

Small reference sites under `tidymagpie.com`. Each site lives in its own folder and deploys to its own subdomain.
The brand homepage at the root domain lists them.

| Folder | Address | What it is |
| --- | --- | --- |
| `sites/home` | `tidymagpie.com` | Brand homepage: the directory of sites, how we work, about, contact, privacy |
| `sites/petit` | `petit.tidymagpie.com` | Petit Planet companion: launch info, codes, neighbors, gift finder, birthdays, checklist |
| `sites/aurora` | `aurora.tidymagpie.com` | Aurora australis go or no-go for Australia and New Zealand: live space weather, cloud and darkness for 36 places |
| `sites/heaven` | `heaven.tidymagpie.com` | Stranger Than Heaven companion: tracker for all 59 achievements act by act, release, editions, cast, gameplay systems, timeline |

## Working on a site

```bash
cd sites/petit
npm install
npm run dev      # local preview
npm run build    # static output in dist/
```

## Deploying (Cloudflare Pages, one project per site)

Create a Pages project connected to this repository with:

- Root directory: `sites/<name>`
- Build command: `npm run build`
- Build output directory: `dist`
- Custom domain: `<name>.tidymagpie.com` (for `sites/home`: `tidymagpie.com` and `www.tidymagpie.com`)
- Build watch paths (Settings, Build): leave the include path at `*`

Every push to `main` then rebuilds every project. The projects share one monthly build allowance, so group
changes into one push. Each build reports to GitHub as a check run named `Cloudflare Pages: <project>`; a commit
with fewer check runs than projects means a build was skipped, and an empty commit starts it again.

## Opening a new site

1. Build it in `sites/<name>` and create its Pages project as above.
2. Once it is live, add it to `sites/home/src/data/sites.json`, copy its `public/favicon.svg` to
   `sites/home/src/emblems/<name>.svg` and register that file in `sites/home/src/components/Emblem.astro`.
   `npm test` in `sites/home` fails until all three agree.
3. Give the new site a footer link back to `https://tidymagpie.com/`.

## Notes on `sites/home`

Static pages with no scripts. The typeface is Archivo (SIL Open Font License), self-hosted through the
`@fontsource-variable/archivo` package, so no request goes to an outside font service. The magpie and the brand
icon are drawn for this site.

```bash
cd sites/home
npm install
npm test                          # the directory matches the real sites in this repository
npm run build
node scripts/smoke.mjs            # browser check; needs: npm install --no-save puppeteer-core
```

## Notes on `sites/aurora`

The pages are static, but the answers are worked out in the visitor's browser from live data:

- Space weather comes straight from NOAA's public services (`services.swpc.noaa.gov`).
- Cloud forecasts come from MET Norway through `functions/api/cloud.js`, a Cloudflare Pages Function that
  Pages picks up from the `functions/` folder with no extra settings. It identifies the site to MET Norway,
  caches each forecast until its `Expires` time and revalidates with `If-Modified-Since`, as
  [MET Norway's terms](https://api.met.no/doc/TermsOfService) ask. The logic is in `server/cloud-proxy.js`.
- Darkness and the moon are calculated on the device with SunCalc.

```bash
cd sites/aurora
npm install
npm test                          # rules, parsers, darkness and the cloud proxy
npm run build
node scripts/dev-server.mjs       # preview at http://localhost:4321 with a stand-in cloud API
node scripts/smoke.mjs            # browser check; needs: npm install --no-save puppeteer-core
```

`scripts/build_locations.py` regenerates the magnetic latitudes (`pip install aacgmv2`). They drift slowly;
once a year is plenty.

## Notes on `sites/heaven`

Fully static. The tracker keeps its ticks in the visitor's browser (`localStorage`), and nothing is sent anywhere.

- `src/data/achievements.json` is the list itself: 59 entries with group, act, hidden flag and a requirement
  written in our own words. It comes from a pre-release list that SEGA has not confirmed, so check it against the
  released game in launch week (15 January 2027) and note any change in `src/data/site.json`.
- `src/lib/progress.ts` holds the counting and filter rules, `src/lib/ticks.ts` wires them to any list marked
  with `data-ticklist`. The launch checklist reuses the same script with its own storage key.
- Hidden story achievement names are masked until the visitor asks to see them.

```bash
cd sites/heaven
npm install
npm test                          # data integrity and the tick-list rules
npm run build
node scripts/smoke.mjs            # browser check; needs: npm install --no-save puppeteer-core
```

## Contact address

Every site gives the same public mailbox, `hello@tidymagpie.com`, and nothing else: no other email address and no
link to this repository. `npm test` in `sites/home` scans all site folders and fails if either appears.

## AdSense account

The domain is registered with Google AdSense, which treats `tidymagpie.com` and its subdomains as one site. Two
things identify the account, both in `sites/home`:

- the `google-adsense-account` meta tag in the page head (`ADSENSE_ACCOUNT` in `src/lib/site.ts`)
- `public/ads.txt`, served at `tidymagpie.com/ads.txt`

`npm test` in `sites/home` fails if the two disagree. Neither loads a script, so no page carries ad code. Ad code
changes what a page does in the visitor's browser, so the privacy page of any site that gets it has to be
rewritten in the same commit.

## Privacy pages

Each privacy page has to match what runs on the live site, including anything the host adds. Cloudflare switches
its Web Analytics script on for the whole domain by default, so every privacy page describes it under "Visit
counting". If that script is ever turned off in the Cloudflare dashboard, take those paragraphs out again.

## Data rules

- Every fact carries a source, listed on the site's Sources page.
- Unknown fields say they are unknown. Nothing is filled in by guesswork.
- No game artwork, screenshots or copied guide text.
- Live readings are shown with their age. When a source is down the page says so; it never fills the gap.
