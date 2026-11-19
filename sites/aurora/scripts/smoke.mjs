// End-to-end check of the built site in a real browser, with NOAA's services and the clock replaced
// by fixed stand-ins so the answers are known in advance.
//
//   npm run build
//   npm install --no-save puppeteer-core
//   node scripts/smoke.mjs                 # CHROME_PATH=/path/to/chrome if it is not /usr/bin/google-chrome
//
// Screenshots land in SHOTS_DIR (default: a folder in the system temp directory).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('This check needs puppeteer-core: npm install --no-save puppeteer-core');
  process.exit(2);
}

const SITE = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.SHOTS_DIR || join(tmpdir(), 'aurora-shots');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const SERVER_CLOCK = '--now=2026-11-16T23:00:00Z';
mkdirSync(OUT, { recursive: true });
const H = 3600000;
const iso = (ms, z = true) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, z ? 'Z' : '');

const REAL_FORECAST = [
  ['2026-11-16T12:00:00', 1.33, 'observed'], ['2026-11-16T15:00:00', 0.67, 'observed'], ['2026-11-16T18:00:00', 0.67, 'observed'],
  ['2026-11-16T21:00:00', 3.67, 'estimated'], ['2026-11-17T00:00:00', 2, 'predicted'], ['2026-11-17T03:00:00', 2.67, 'predicted'],
  ['2026-11-17T06:00:00', 3.33, 'predicted'], ['2026-11-17T09:00:00', 3.33, 'predicted'], ['2026-11-17T12:00:00', 3.67, 'predicted'],
  ['2026-11-17T15:00:00', 3.67, 'predicted'], ['2026-11-17T18:00:00', 3.67, 'predicted'], ['2026-11-17T21:00:00', 4.67, 'predicted'],
  ['2026-11-18T00:00:00', 4.67, 'predicted'], ['2026-11-18T03:00:00', 3.67, 'predicted'], ['2026-11-18T06:00:00', 3.67, 'predicted'],
  ['2026-11-18T09:00:00', 3.67, 'predicted'], ['2026-11-18T12:00:00', 2.67, 'predicted'], ['2026-11-18T15:00:00', 2.67, 'predicted'],
  ['2026-11-18T18:00:00', 2.33, 'predicted'], ['2026-11-18T21:00:00', 2, 'predicted'], ['2026-11-19T00:00:00', 2.33, 'predicted'],
];
const OUTLOOK = `:Product: 27-day Space Weather Outlook Table 27DO.txt
:Issued: 2026 Nov 16 0233 UTC
# Prepared by the US Dept. of Commerce, NOAA, Space Weather Prediction Center
#
#   UTC      Radio Flux   Planetary   Largest
#  Date       10.7 cm      A Index    Kp Index
${[4,5,5,3,4,4,3,2,2,2,4,3,2,2,3,5,6,4,3,2,2,2,2,2,2,2,2].map((kp, i) => { const d = new Date(Date.UTC(2026, 10, 16 + i)); return `${d.getUTCFullYear()} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${String(d.getUTCDate()).padStart(2, '0')}     119          15          ${kp}`; }).join('\n')}
`;

function noaa(scenario, now) {
  const storm = scenario.storm;
  const kp = storm ? 6.67 : 0.33;
  const kp1m = Array.from({ length: 12 }, (_, i) => ({ time_tag: iso(now - (14 - i) * 60000, false).slice(0, 16) + ':00', estimated_kp: kp, kp_index: Math.round(kp), kp: 'x' }));
  const forecast = REAL_FORECAST.map(([time_tag, v, observed]) => {
    const value = storm && observed === 'predicted' ? Math.min(9, v + 3.33) : v;
    return { time_tag, kp: Math.round(value * 100) / 100, observed, noaa_scale: value >= 4.5 ? `G${Math.min(5, Math.round(value) - 4)}` : null };
  });
  const header = ['time_tag', 'speed', 'density', 'temperature', 'bx', 'by', 'bz', 'bt', 'vx', 'vy', 'vz', 'propagated_time_tag'];
  const wind = [header];
  for (let i = 56; i >= 0; i--) {
    const t = now - (i + 3) * 60000;
    const speed = storm ? 680 + Math.sin(i / 5) * 12 : 292 + Math.sin(i / 5) * 3;
    const bz = storm ? -14 + Math.sin(i / 4) * 5 : 0.8 + Math.sin(i / 6) * 2.2;
    wind.push([iso(t), +speed.toFixed(1), storm ? 9.4 : 2.05, 33000, 3.9, -3.0, +bz.toFixed(2), storm ? 19.2 : 5.05, -speed, -5, -20, iso(t + (1.5e6 / speed) * 1000)]);
  }
  const power = storm ? 95 : 11;
  const hemi = ['#Aurora Hemispheric Power Tabular Values', '# Observation        Forecast            North    South',
    ...Array.from({ length: 6 }, (_, i) => { const t = now - (30 - i * 5) * 60000; const f = (ms) => iso(ms).slice(0, 16).replace('T', '_'); return `${f(t)}    ${f(t + 70 * 60000)}      ${power - 2}      ${power}`; }), ''].join('\n');
  return {
    '/json/planetary_k_index_1m.json': ['application/json', JSON.stringify(kp1m)],
    '/products/noaa-planetary-k-index-forecast.json': ['application/json', JSON.stringify(forecast)],
    '/products/geospace/propagated-solar-wind-1-hour.json': ['application/json', JSON.stringify(wind)],
    '/text/aurora-nowcast-hemi-power.txt': ['text/plain', hemi],
    '/text/27-day-outlook.txt': ['text/plain', OUTLOOK],
  };
}

async function withServer(args, port, fn, serverClock = SERVER_CLOCK) {
  const child = spawn('node', ['scripts/dev-server.mjs', serverClock, ...args], { cwd: SITE, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => child.stdout.once('data', resolve));
  try { return await fn(`http://localhost:${port}`); } finally { child.kill(); }
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP services.swpc.noaa.gov 127.0.0.1'] });
const results = [];
let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

async function open(base, path, scenario, { width = 1280, tz = 'Australia/Hobart', shot } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await page.emulateTimezone(tz);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.evaluateOnNewDocument((fixed) => {
    const Real = Date; const offset = fixed - Real.now();
    class Fake extends Real { constructor(...a) { if (a.length === 0) super(Real.now() + offset); else super(...a); } static now() { return Real.now() + offset; } }
    window.Date = Fake;
  }, scenario.now);
  const table = noaa(scenario, scenario.now);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.hostname === 'services.swpc.noaa.gov') {
      const hit = table[u.pathname];
      if (scenario.noaaDown || !hit) return req.respond({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'down' });
      return req.respond({ status: 200, contentType: hit[0], headers: { 'access-control-allow-origin': '*' }, body: hit[1] });
    }
    req.continue();
  });
  await page.goto(base + path, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  return { page, errors };
}

const text = (page, sel) => page.$eval(sel, (n) => n.textContent.replace(/\s+/g, ' ').trim()).catch(() => null);
const texts = (page, sel) => page.$$eval(sel, (ns) => ns.map((n) => n.textContent.replace(/\s+/g, ' ').trim()));

const DAY = { now: Date.UTC(2026, 10, 16, 23, 53), storm: false };          // 10:53 am in Hobart
const NIGHT_STORM = { now: Date.UTC(2026, 10, 17, 13, 20), storm: true };   // 12:20 am in Hobart and Melbourne
const NIGHT_QUIET = { now: Date.UTC(2026, 10, 17, 13, 20), storm: false };

// 1. Clear sky everywhere.
await withServer(['--cloud-pct=10'], 4401, async (base) => {
  let { page, errors } = await open(base, '/', DAY, { shot: 'home-day-desktop' });
  check('home: no script errors', errors.length === 0, errors.join(' | '));
  check('home: Kp now shown', (await text(page, '[data-aurora="space"] [data-slot="kp"]')) === '0.3', await text(page, '[data-aurora="space"] [data-slot="kp"]'));
  check('home: Kp note', /^quiet · \d+ min ago$/.test(await text(page, '[data-slot="kp-note"]')), await text(page, '[data-slot="kp-note"]'));
  check('home: Bz shown', /nT$/.test(await text(page, '[data-slot="bz"]')), await text(page, '[data-slot="bz"]'));
  check('home: speed slow', /^slow · density 2\.\d per cm³$/.test(await text(page, '[data-slot="speed-note"]')), await text(page, '[data-slot="speed-note"]'));
  check('home: power', (await text(page, '[data-slot="power"]')) === '11 GW' && /^low/.test(await text(page, '[data-slot="power-note"]')));
  check('home: arrival lead', /reaches Earth in about (1 h( \d+ min)?|\d+ min)\.$/.test(await text(page, '[data-slot="lead"]')), await text(page, '[data-slot="lead"]'));
  check('home: sparkline drawn', (await page.$('[data-slot="spark"]:not([hidden]) svg polyline')) !== null);
  const rows = await page.$$eval('[data-aurora="row"]', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
  check('home: 13 rows filled', rows.length === 13 && rows.every((r) => !/Loading|…/.test(r.join(''))), JSON.stringify(rows.slice(0, 3)));
  const row = (name) => rows.find((r) => r[0].startsWith(name));
  check('home: Hobart is a go under clear sky', row('Hobart')[4] === 'Go11 pm to 3:36 am' && row('Hobart')[2] === '3.7' && row('Hobart')[3] === '10%', JSON.stringify(row('Hobart')));
  check('home: Launceston is a maybe (one step short)', /^Maybe/.test(row('Launceston')[4]), JSON.stringify(row('Launceston')));
  check('home: Melbourne is a no-go', row('Melbourne')[4] === 'No-go', JSON.stringify(row('Melbourne')));
  check('home: Brisbane is a no-go and beyond Kp 9', row('Brisbane')[4] === 'No-go' && row('Brisbane')[1] === 'Beyond Kp 9', JSON.stringify(row('Brisbane')));
  const outlook = await texts(page, '[data-aurora="outlook"] li');
  check('home: 27-day outlook starts with tonight', outlook.length === 26 && outlook[0] === 'Tue 17 Nov Kp 5', `${outlook.length} ${outlook[0]}`);
  check('home: outlook issue note', (await text(page, '[data-aurora="outlook"] [data-slot="outlook-note"]')) === 'Issued by NOAA on 16 Nov 2026 at 02:33 UTC.', await text(page, '[data-aurora="outlook"] [data-slot="outlook-note"]'));
  await page.close();

  ({ page, errors } = await open(base, '/', DAY, { width: 390, shot: 'home-day-mobile' }));
  check('home mobile: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), String(await page.evaluate(() => document.documentElement.scrollWidth)));
  check('home mobile: verdicts fit on screen without sideways scrolling', await page.evaluate(() => [...document.querySelectorAll('[data-aurora="row"] .pill')].every((n) => { const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }) && [...document.querySelectorAll('.table-scroll')].every((n) => n.scrollWidth <= n.clientWidth + 1)));
  await page.close();

  ({ page, errors } = await open(base, '/forecast/hobart/', DAY, { shot: 'hobart-day-desktop' }));
  check('hobart day: no script errors', errors.length === 0, errors.join(' | '));
  check('hobart day: kicker', /^Tonight in Hobart · dark from 10:15 pm to 3:36 am$/.test(await text(page, '[data-slot="kicker"]')), await text(page, '[data-slot="kicker"]'));
  check('hobart day: verdict go', (await text(page, '[data-slot="word"]')) === 'Go' && (await page.$eval('[data-slot="verdict"]', (n) => n.dataset.verdict)) === 'go');
  check('hobart day: sentence', (await text(page, '[data-slot="why"]')) === 'Kp is forecast to reach about 4 around 11 pm, and Hobart usually needs Kp 4. The sky should be mostly clear (10% cloud). Get away from town lights and look to the south. That only just clears the bar, so expect it low on the horizon and paler to the eye than in photos.', await text(page, '[data-slot="why"]'));
  check('hobart day: best window', /^Best window: 11 pm to 3:36 am\. Check again/.test(await text(page, '[data-slot="next"]')), await text(page, '[data-slot="next"]'));
  check('hobart day: activity card', (await text(page, '[data-slot="activity-main"]')) === 'Kp 0.3 now' && /Hobart needs Kp 4\. Forecast peak tonight: Kp 3\.7 around 11 pm\./.test(await text(page, '[data-slot="activity-sub"]')), await text(page, '[data-slot="activity-sub"]'));
  check('hobart day: sky card', (await text(page, '[data-slot="sky-main"]')) === '10% cloud tonight', await text(page, '[data-slot="sky-main"]'));
  check('hobart day: dark card', (await text(page, '[data-slot="dark-main"]')) === 'Fully dark 10:15 pm to 3:36 am' && /^5 h 2\d min\. Moon 5\d% lit, sets about 2:1\d am\.$/.test(await text(page, '[data-slot="dark-sub"]')), await text(page, '[data-slot="dark-sub"]'));
  const hours = await page.$$eval('[data-slot="hours"] tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
  check('hobart day: hour rows', hours.length === 6 && hours[0][0] === '10 pm' && hours[5][0] === '3 am', JSON.stringify(hours));
  check('hobart day: first hour borderline, later go', hours[0][4] === 'Maybe' && hours[1][4] === 'Go' && hours[0][1] === '3.3', JSON.stringify(hours.map((h) => h[4])));
  const nights = await page.$$eval('[data-slot="nights"] tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
  check('hobart day: three nights, four columns', nights.length === 3 && nights.every((n) => n.length === 4) && nights[0][0] === 'TonightTue 17 Novdark 10:15 pm to 3:36 am', JSON.stringify(nights));
  check('hobart day: later nights named by weekday', /^Wednesday nightWed 18 Novdark 10:17 pm to 3:35 am/.test(nights[1][0]) && /^Thursday nightThu 19 Nov/.test(nights[2][0]), JSON.stringify(nights.map((n) => n[0])));
  check('hobart day: second night go only while the forecast holds', nights[1][3] === 'Go10:17 pm to 11 pm', nights[1][3]);
  check('hobart day: third night uses the daily outlook', nights[2][1] === '3daily' && /^Maybe/.test(nights[2][3]), JSON.stringify(nights[2]));
  const stamp = await text(page, '.dash > [data-slot="stamp"]');
  check('hobart day: stamp', /^Checked 10:53 am · Kp reading from \d+ min ago · cloud forecast issued (just now|\d+ min ago)\. Times are local to Hobart\.$/.test(stamp), stamp);
  const strip = await page.$$eval('.dash [data-slot="outlook"] li', (ns) => ns.map((n) => `${n.dataset.tone}:${n.textContent.replace(/\s+/g, ' ').trim()}`));
  check('hobart day: outlook coloured for Hobart', strip.length === 26 && strip[0] === 'go:Tue 17 Nov Kp 5' && strip[2] === 'maybe:Thu 19 Nov Kp 3' && strip.includes('no:Mon 23 Nov Kp 2'), strip.slice(0, 8).join(', '));
  await page.close();

  ({ page, errors } = await open(base, '/forecast/hobart/', DAY, { width: 390, shot: 'hobart-day-mobile' }));
  check('hobart mobile: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.close();

  ({ page, errors } = await open(base, '/forecast/melbourne/', NIGHT_STORM, { tz: 'Australia/Melbourne', shot: 'melbourne-storm-night' }));
  check('melbourne storm: no script errors', errors.length === 0, errors.join(' | '));
  check('melbourne storm: live headline', /^Right now in Melbourne · 12:20 am$/.test(await text(page, '[data-slot="kicker"]')), await text(page, '[data-slot="kicker"]'));
  check('melbourne storm: go', (await text(page, '[data-slot="word"]')) === 'Go');
  check('melbourne storm: sentence', (await text(page, '[data-slot="why"]')) === 'Kp is about 7 right now, and Melbourne usually needs Kp 7. The sky is mostly clear (10% cloud). Get away from town lights and look to the south. That only just clears the bar, so expect it low on the horizon and paler to the eye than in photos.', await text(page, '[data-slot="why"]'));
  check('melbourne storm: rest of tonight', /^Rest of tonight: go from 12:20 am to 4 am\.$/.test(await text(page, '[data-slot="next"]')), await text(page, '[data-slot="next"]'));
  const mh = await page.$$eval('[data-slot="hours"] tr', (trs) => trs.map((tr) => ({ cls: tr.className, cells: [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()) })));
  check('melbourne storm: current hour flagged live', mh[0].cls === 'current' && /^12 am\s*now$/.test(mh[0].cells[0]) && /^6\.7\s*live$/.test(mh[0].cells[1]), JSON.stringify(mh[0]));
  check('melbourne storm: space panel storm words', (await text(page, '[data-slot="kp-note"]')).startsWith('G3 strong storm') && /strongly south/.test(await text(page, '[data-slot="bz-note"]')) && /^fast/.test(await text(page, '[data-slot="speed-note"]')) && /^high/.test(await text(page, '[data-slot="power-note"]')), [await text(page, '[data-slot="kp-note"]'), await text(page, '[data-slot="bz-note"]'), await text(page, '[data-slot="speed-note"]')].join(' / '));
  await page.close();

  ({ page, errors } = await open(base, '/forecast/brisbane/', NIGHT_STORM, { tz: 'Australia/Brisbane' }));
  check('brisbane storm: still no-go, own wording', (await text(page, '[data-slot="word"]')) === 'No-go' && /Brisbane is too far north for that/.test(await text(page, '[data-slot="why"]')), await text(page, '[data-slot="why"]'));
  await page.close();

  ({ page, errors } = await open(base, '/forecast/hobart/', NIGHT_QUIET, { shot: 'hobart-quiet-night' }));
  check('hobart quiet night: no-go right now', (await text(page, '[data-slot="word"]')) === 'No-go' && /^Kp is about 0 right now, well short: Hobart usually needs Kp 4\.$/.test(await text(page, '[data-slot="why"]')), await text(page, '[data-slot="why"]'));
  check('hobart quiet night: forecast hours still listed', /^Rest of tonight: go from 1 am to 3:36 am\.$/.test(await text(page, '[data-slot="next"]')), await text(page, '[data-slot="next"]'));
  await page.close();

  ({ page, errors } = await open(base, '/forecast/tasmania/', DAY, { shot: 'tasmania-day' }));
  const tas = await page.$$eval('[data-aurora="row"]', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
  check('tasmania: seven rows with verdicts', errors.length === 0 && tas.length === 7 && tas.every((r) => /^(Go|Maybe|No-go)/.test(r[4])), JSON.stringify(tas.map((r) => [r[0], r[4]])));
  await page.close();

  ({ page, errors } = await open(base, '/my-location/', DAY, { shot: 'my-location-empty' }));
  check('my location: dashboard hidden until a spot is set', await page.$eval('[data-aurora="place"]', (n) => n.hidden));
  await page.type('[data-slot="lat"]', '-41.07');
  await page.type('[data-slot="lon"]', '145.9');
  await Promise.all([page.waitForFunction(() => /^(Go|Maybe|No-go)$/.test(document.querySelector('[data-slot="word"]').textContent)), page.click('form button[type="submit"]')]);
  check('my location: typed coordinates give an answer', errors.length === 0 && !(await page.$eval('[data-aurora="place"]', (n) => n.hidden)), errors.join(' | '));
  check('my location: facts line', /^Using 41\.07°S, 145\.90°E \(rounded to about 1 km\)\. Magnetic latitude 51\.6°S\. A display you can see needs Kp 5\.$/.test(await text(page, '[data-slot="facts"]')), await text(page, '[data-slot="facts"]'));
  check('my location: kicker names "your spot"', /^Tonight at your spot/.test(await text(page, '[data-slot="kicker"]')), await text(page, '[data-slot="kicker"]'));
  check('my location: saved in this browser only', (await page.evaluate(() => localStorage.getItem('tm-aurora-my-spot-v1'))) === '{"lat":-41.07,"lon":145.9}');
  await page.screenshot({ path: `${OUT}/my-location-set.png`, fullPage: true });
  await page.click('[data-slot="forget"]');
  check('my location: forget clears it', (await page.evaluate(() => localStorage.getItem('tm-aurora-my-spot-v1'))) === null && await page.$eval('[data-aurora="place"]', (n) => n.hidden) && (await page.$eval('[data-slot="lat"]', (n) => n.value)) === '', await text(page, '[data-aurora="custom"] [data-slot="status"]'));
  await page.type('[data-slot="lat"]', '59.9');
  await page.type('[data-slot="lon"]', '10.7');
  await page.click('form button[type="submit"]');
  await new Promise((r) => setTimeout(r, 200));
  check('my location: outside coverage is refused politely', /outside the area this tool covers/.test(await text(page, '[data-aurora="custom"] [data-slot="status"]')) && await page.$eval('[data-aurora="place"]', (n) => n.hidden), await text(page, '[data-aurora="custom"] [data-slot="status"]'));
  await page.$eval('[data-slot="lat"]', (n) => { n.value = ''; });
  await page.$eval('[data-slot="lon"]', (n) => { n.value = ''; });
  await page.type('[data-slot="lat"]', '42.88');
  await page.type('[data-slot="lon"]', '147.33');
  await Promise.all([page.waitForFunction(() => !document.querySelector('[data-aurora="place"]').hidden), page.click('form button[type="submit"]')]);
  check('my location: a latitude typed without its minus sign is read as south', /^Using 42\.88°S, 147\.33°E/.test(await text(page, '[data-slot="facts"]')), await text(page, '[data-slot="facts"]'));
  await page.close();

  ({ page, errors } = await open(base, '/forecast/hobart/', { ...DAY, noaaDown: true }, { shot: 'hobart-noaa-down' }));
  check('NOAA down: no invented answer', errors.length === 0 && (await text(page, '[data-slot="word"]')) === 'No answer yet' && (await page.$eval('[data-slot="verdict"]', (n) => n.dataset.verdict)) === 'none', await text(page, '[data-slot="why"]'));
  check('NOAA down: panel says so', /delayed or unavailable/.test(await text(page, '[data-aurora="space"] [data-slot="stamp"]')) && (await text(page, '[data-aurora="space"] [data-slot="kp"]')) === '–');
  await page.close();
});

// 2. Overcast everywhere.
await withServer(['--cloud-pct=95'], 4402, async (base) => {
  const { page, errors } = await open(base, '/forecast/hobart/', DAY, { shot: 'hobart-overcast' });
  check('overcast: no-go, blamed on cloud', errors.length === 0 && (await text(page, '[data-slot="word"]')) === 'No-go' && /cloud cover will be about 95%, which hides it/.test(await text(page, '[data-slot="why"]')), await text(page, '[data-slot="why"]'));
  await page.close();
});

// 3. Cloud service failing.
await withServer(['--cloud-down'], 4403, async (base) => {
  const { page, errors } = await open(base, '/forecast/hobart/', DAY, { shot: 'hobart-cloud-down' });
  check('cloud down: hedged maybe', errors.length === 0 && (await text(page, '[data-slot="word"]')) === 'Maybe' && /cloud forecast is unavailable/.test(await text(page, '[data-slot="why"]')), await text(page, '[data-slot="why"]'));
  check('cloud down: sky card says so', (await text(page, '[data-slot="sky-main"]')) === 'Cloud forecast unavailable');
  await page.close();
});

// 4. Geminids page: weeks ahead, then inside the cloud forecast's reach.
await withServer(['--cloud-pct=10'], 4404, async (base) => {
  let { page, errors } = await open(base, '/geminids/', DAY, { shot: 'geminids-early-desktop' });
  check('geminids early: no script errors', errors.length === 0, errors.join(' | '));
  check('geminids early: 36 places', (await page.$$('[data-geminid]')).length === 36);
  const early = await texts(page, '[data-geminid] .pill');
  check('geminids early: sky waits for the forecast', early.length === 108 && early.every((t) => /^From \d+ Dec$/.test(t)), early[0]);
  const hobart = await page.$eval('[data-geminid] ', (tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
  check('geminids early: Hobart row', hobart[0].startsWith('Hobart') && hobart[1] === '11:36 pm to 3:10 am' && hobart[2] === '14° at 3:06 am' && hobart[3] === 'about 35 10 from a town', JSON.stringify(hobart));
  await page.close();

  ({ page, errors } = await open(base, '/geminids/', DAY, { width: 390, shot: 'geminids-early-mobile' }));
  check('geminids mobile: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), String(await page.evaluate(() => document.documentElement.scrollWidth)));
  await page.close();
}, '--now=2026-11-16T23:00:00Z');

await withServer(['--cloud-pct=10'], 4405, async (base) => {
  const SUNDAY = { now: Date.UTC(2026, 11, 13, 0, 0), storm: false }; // 11 am Sunday 13 December in Hobart
  const { page, errors } = await open(base, '/geminids/', SUNDAY, { shot: 'geminids-live' });
  check('geminids live: no script errors', errors.length === 0, errors.join(' | '));
  await page.waitForFunction(() => !document.querySelector('[data-geminid-live]').hidden, { timeout: 8000 }).catch(() => {});
  const row = await page.$eval('[data-geminid]', (tr) => [...tr.querySelectorAll('[data-night]')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
  check('geminids live: Saturday over, Sunday and Monday clear', row[0] === 'Sat 12 Over' && row[1] === 'Sun 13 Clear 10% cloud' && row[2] === 'Mon 14 Clear 10% cloud', JSON.stringify(row));
  await page.close();
}, '--now=2026-12-13T00:00:00Z');

await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures} passed, ${failures} failed. Screenshots: ${OUT}`);
process.exit(failures ? 1 : 0);
