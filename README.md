# Tidy Magpie

Small reference sites under `tidymagpie.com`. Each site lives in its own folder and deploys to its own subdomain.

| Folder | Subdomain | What it is |
| --- | --- | --- |
| `sites/petit` | `petit.tidymagpie.com` | Petit Planet companion: launch info, codes, neighbors, gift finder, birthdays, checklist |

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

## Data rules

- Every fact carries a source, listed on the site's Sources page.
- Unknown fields say they are unknown. Nothing is filled in by guesswork.
- No game artwork, screenshots or copied guide text.
