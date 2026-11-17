// End-to-end check of the built site in a real browser.
//
//   npm run build
//   npm install --no-save puppeteer-core
//   node scripts/smoke.mjs                 # CHROME_PATH=/path/to/chrome if it is not /usr/bin/google-chrome
//
// Screenshots land in SHOTS_DIR (default: a folder in the system temp directory).
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('This check needs puppeteer-core: npm install --no-save puppeteer-core');
  process.exit(2);
}

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const OUT = process.env.SHOTS_DIR || join(tmpdir(), 'heaven-shots');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(DIST, '404.html')));
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const results = [];
let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const KEY = 'tm-heaven-achievements-v1';

const context = await browser.createBrowserContext();
async function open(path, { width = 1280, shot } = {}) {
  const page = await context.newPage();
  await page.setViewport({ width, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + path, { waitUntil: 'networkidle0' });
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  return { page, errors };
}
const text = (page, sel) => page.$eval(sel, (n) => n.textContent.replace(/\s+/g, ' ').trim()).catch(() => null);
const shownRows = (page) => page.$$eval('[data-item]', (rows) => rows.filter((r) => !r.hidden).map((r) => r.dataset.item));

// --- tracker ---
let { page, errors } = await open('/achievements/', { shot: 'achievements-desktop' });
check('tracker: no script errors', errors.length === 0, errors.join(' | '));
check('tracker: 59 rows', (await shownRows(page)).length === 59);
check('tracker: starts empty', (await text(page, '[data-progress-text]')) === '0 of 59 done (0%)', await text(page, '[data-progress-text]'));
check('tracker: hidden names masked by default', await page.$eval('[data-item="story-1-1"]', (row) => getComputedStyle(row.querySelector('.name-real')).display === 'none' && getComputedStyle(row.querySelector('.name-masked')).display !== 'none'));
check('tracker: completion entry cannot be ticked by hand', await page.$eval('[data-item="all"] input', (box) => box.disabled && !box.checked));
await page.click('[data-item="sub-1"] input');
await page.click('[data-item="kills-100"] input');
check('tracker: ticks count', (await text(page, '[data-progress-text]')) === '2 of 59 done (3%)', await text(page, '[data-progress-text]'));
check('tracker: group counters', (await text(page, '[data-group-count="substories"]')) === '1/5' && (await text(page, '[data-group-count="combat"]')) === '1/9');
check('tracker: saved in this browser', (await page.evaluate((k) => localStorage.getItem(k), KEY)) === '["sub-1","kills-100"]');
await page.click('button[data-filter-group="substories"]');
check('tracker: category filter', JSON.stringify(await shownRows(page)) === JSON.stringify(['sub-1', 'sub-2', 'sub-3', 'sub-4', 'sub-5']), JSON.stringify(await shownRows(page)));
check('tracker: other sections collapse', await page.$$eval('[data-section]', (s) => s.filter((n) => !n.hidden).length === 1));
await page.click('button[data-filter-group="all"]');
await page.select('select[data-filter="act"]', '3');
check('tracker: act filter', JSON.stringify((await shownRows(page)).sort()) === JSON.stringify(['job-3', 'show-3', 'story-3', 'story-3-1', 'story-3-2', 'sub-3']), JSON.stringify(await shownRows(page)));
await page.select('select[data-filter="act"]', 'any');
check('tracker: entries tied to no act', (await shownRows(page)).length === 31, String((await shownRows(page)).length));
await page.select('select[data-filter="act"]', 'all');
await page.click('[data-pref="hideDone"]');
check('tracker: hide done', (await shownRows(page)).length === 57 && !(await shownRows(page)).includes('sub-1'));
await page.click('[data-pref="hideDone"]');
await page.click('[data-pref="reveal"]');
check('tracker: reveal shows the real names', (await text(page, '[data-item="story-3-2"] .name-real')) === "Long Day's Journey into Night" && await page.$eval('[data-item="story-3-2"]', (row) => getComputedStyle(row.querySelector('.name-real')).display !== 'none' && getComputedStyle(row.querySelector('.name-masked')).display === 'none'));
await page.close();

({ page, errors } = await open('/achievements/'));
check('tracker: ticks and choices survive a reload', (await text(page, '[data-progress-text]')) === '2 of 59 done (3%)' && await page.$eval('[data-item="sub-1"] input', (b) => b.checked) && await page.$eval('[data-pref="reveal"]', (b) => b.checked) && await page.$eval('.tracker', (n) => n.classList.contains('reveal')));
await page.close();

// --- act page shares the same ticks ---
({ page, errors } = await open('/acts/act-1-kokura-1915/', { shot: 'act-1-desktop' }));
check('act page: no script errors', errors.length === 0, errors.join(' | '));
check('act page: six entries, one already ticked', (await shownRows(page)).length === 6 && (await text(page, '[data-progress-text]')) === '1 of 6 done (17%)', await text(page, '[data-progress-text]'));
check('act page: whole-game count', (await text(page, '[data-overall-text]')) === '2 of 59', await text(page, '[data-overall-text]'));
await page.click('[data-item="job-1"] input');
check('act page: tick is stored with the rest', (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).length, KEY)) === 3);
await page.close();

({ page, errors } = await open('/achievements/#act-3'));
check('tracker: #act-3 opens filtered to Act 3', (await shownRows(page)).length === 6 && (await page.$eval('select[data-filter="act"]', (s) => s.value)) === '3');
await page.close();

// --- completion entry follows the rest; reset needs two presses ---
({ page, errors } = await open('/achievements/'));
await page.evaluate((k) => { const ids = [...document.querySelectorAll('[data-item]')].map((r) => r.dataset.item).filter((id) => id !== 'all'); localStorage.setItem(k, JSON.stringify(ids)); }, KEY);
await page.reload({ waitUntil: 'networkidle0' });
check('tracker: all 58 done ticks the 59th', (await text(page, '[data-progress-text]')) === '59 of 59 done (100%)' && await page.$eval('[data-item="all"] input', (b) => b.checked));
await page.click('[data-item="minigames-10"] input');
check('tracker: unticking one unticks the completion entry', (await text(page, '[data-progress-text]')) === '57 of 59 done (97%)' && !(await page.$eval('[data-item="all"] input', (b) => b.checked)), await text(page, '[data-progress-text]'));
await page.click('[data-reset]');
check('reset: first press only arms it', (await text(page, '[data-reset]')) === 'Press again to clear every tick' && (await text(page, '[data-progress-text]')).startsWith('57 of 59'));
await page.click('[data-reset]');
check('reset: second press clears', (await text(page, '[data-progress-text]')) === '0 of 59 done (0%)' && (await page.evaluate((k) => localStorage.getItem(k), KEY)) === '[]' && (await text(page, '[data-reset]')) === 'Clear all ticks');
await page.close();

// --- launch checklist keeps its own ticks ---
({ page, errors } = await open('/checklist/', { shot: 'checklist-desktop' }));
await page.click('[data-item="edition"] input');
check('checklist: own progress and storage', errors.length === 0 && (await text(page, '[data-progress-text]')) === '1 of 9 done (11%)' && (await page.evaluate(() => localStorage.getItem('tm-heaven-launch-v1'))) === '["edition"]' && (await page.evaluate((k) => localStorage.getItem(k), KEY)) === '[]');
await page.close();

// --- countdown and static pages ---
({ page, errors } = await open('/', { shot: 'home-desktop' }));
const days = await text(page, '[data-days]');
check('home: countdown shows a number of days', errors.length === 0 && /^\d+$/.test(days) && /^days? to go$/.test(await text(page, '[data-days-label]')), days);
await page.close();
for (const [path, name] of [['/', 'home-mobile'], ['/achievements/', 'achievements-mobile'], ['/editions/', 'editions-mobile'], ['/cast/', 'cast-mobile'], ['/release/', 'release-mobile'], ['/acts/act-5-shinjuku-1965/', 'act-5-mobile']]) {
  ({ page, errors } = await open(path, { width: 390, shot: name }));
  check(`${name}: fits a phone without sideways scrolling`, errors.length === 0 && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), String(await page.evaluate(() => document.documentElement.scrollWidth)));
  await page.close();
}
for (const [path, name] of [['/editions/', 'editions-desktop'], ['/release/', 'release-desktop'], ['/gameplay/', 'gameplay-desktop'], ['/cast/', 'cast-desktop'], ['/acts/', 'acts-desktop'], ['/timeline/', 'timeline-desktop'], ['/sources/', 'sources-desktop'], ['/like-a-dragon-connection/', 'connection-desktop']]) {
  ({ page, errors } = await open(path, { shot: name }));
  check(`${name}: loads cleanly`, errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures} passed, ${failures} failed. Screenshots: ${OUT}`);
process.exit(failures ? 1 : 0);
