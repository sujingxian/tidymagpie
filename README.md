# Tidy Magpie

Small reference sites under `tidymagpie.com`. Each site lives in its own folder and deploys to its own subdomain.

| Folder | Subdomain | What it is |
| --- | --- | --- |
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
- Custom domain: `<name>.tidymagpie.com`
- Build watch paths (Settings, Build): include `sites/<name>/*`

After that, every push to `main` that touches the site's folder redeploys it. Without the watch path, a push
rebuilds every project, which uses up the monthly build allowance faster.

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

## Data rules

- Every fact carries a source, listed on the site's Sources page.
- Unknown fields say they are unknown. Nothing is filled in by guesswork.
- No game artwork, screenshots or copied guide text.
- Live readings are shown with their age. When a source is down the page says so; it never fills the gap.
