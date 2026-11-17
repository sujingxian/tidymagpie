# Tidy Magpie

Small reference sites under `tidymagpie.com`. Each site lives in its own folder and deploys to its own subdomain.

| Folder | Subdomain | What it is |
| --- | --- | --- |
| `sites/petit` | `petit.tidymagpie.com` | Petit Planet companion: launch info, codes, neighbors, gift finder, birthdays, checklist |
| `sites/aurora` | `aurora.tidymagpie.com` | Aurora australis go or no-go for Australia and New Zealand: live space weather, cloud and darkness for 36 places |

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

After that, every push to `main` that touches the site's folder redeploys it.

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

## Data rules

- Every fact carries a source, listed on the site's Sources page.
- Unknown fields say they are unknown. Nothing is filled in by guesswork.
- No game artwork, screenshots or copied guide text.
- Live readings are shown with their age. When a source is down the page says so; it never fills the gap.
