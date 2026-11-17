// Browser check of the built site.
//
//   npm run build
//   npm install --no-save puppeteer-core
//   node scripts/smoke.mjs                 # CHROME_PATH=/path/to/chrome if it is not /usr/bin/google-chrome
//
// Screenshots land in SHOTS_DIR (default: a folder in the system temp directory).
import { createServer } from 'node:http';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('This check needs puppeteer-core: npm install --no-save puppeteer-core');
  process.exit(2);
}

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const OUT = process.env.SHOTS_DIR || join(tmpdir(), 'home-shots');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(DIST, '404.html')).catch(() => 'Not found'));
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;

function pagesIn(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...pagesIn(full));
    else if (name === 'index.html') found.push('/' + relative(DIST, dir).split('\\').join('/') + (dir === DIST.replace(/\/$/, '') ? '' : '/'));
  }
  return found;
}
const paths = pagesIn(DIST.replace(/\/$/, '')).map((p) => p.replace(/\/+/g, '/')).sort();

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const results = [];
let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

for (const path of paths) {
  for (const [label, width] of [['desktop', 1280], ['mobile', 390]]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900, deviceScaleFactor: width < 500 ? 2 : 1 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', (r) => errors.push(`failed: ${r.url()}`));
    await page.goto(base + path, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    const name = (path === '/' ? 'home' : path.replace(/\//g, ' ').trim().replace(/ /g, '-')) + '-' + label;
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${name}: loads cleanly and fits the screen`, errors.length === 0 && wide <= 1, errors.join(' | ') || (wide > 1 ? `${wide}px too wide` : ''));
    if (label === 'desktop') {
      const font = await page.evaluate(() => document.fonts.check("800 40px 'Archivo Variable'"));
      check(`${name}: brand typeface is loaded`, font);
    }
    if (path === '/') {
      const links = await page.$$eval('.shelf .button', (as) => as.map((a) => a.href));
      check(`${name}: every shelf links to its own subdomain`, links.length >= 3 && links.every((h) => /^https:\/\/[a-z]+\.tidymagpie\.com\/$/.test(h)), links.join(' '));
      const onShelf = await page.evaluate(() => {
        const bird = document.querySelector('.magpie').getBoundingClientRect();
        const hero = document.querySelector('.hero').getBoundingClientRect();
        return Math.abs(bird.bottom - hero.bottom);
      });
      check(`${name}: the bird stands on the shelf`, onShelf <= 6, `${onShelf}px off`);
    }
    await page.close();
  }
}

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures} passed, ${failures} failed. Screenshots: ${OUT}`);
process.exit(failures ? 1 : 0);
