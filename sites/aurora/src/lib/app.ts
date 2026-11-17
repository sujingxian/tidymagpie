// Browser glue: fetch the live data, run the analysis, fill in the page.
import { analyse, outlookFor, type Analysis, type NightView, type Place, type Slot, type Space } from './analyse.ts';
import { fetchCloud, pointKey, type CloudPoint } from './cloud.ts';
import {
  bearingFromGrid,
  mlatFromGrid,
  thresholdsFor,
  type Activity,
  type MlatGrid,
  type Verdict,
} from './model.ts';
import {
  NOAA_URLS,
  parseHemiPower,
  parseKpForecast,
  parseKpNow,
  parseOutlook27,
  parseSolarWind,
  parseWindSummary,
} from './noaa.ts';
import { moonAltitudeDeg } from './sky.ts';
import {
  agoText,
  bzWord,
  cloudWord,
  durationText,
  explain,
  kpText,
  kpWord,
  powerWord,
  speedWord,
  VERDICT_LABEL,
} from './words.ts';
import gridData from '../data/mlat-grid.json';

const grid = gridData as unknown as MlatGrid;
const REFRESH_MS = 5 * 60 * 1000;
const REDRAW_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const CUSTOM_KEY = 'tm-aurora-my-spot-v1';
const HOUR = 3600000;

let space: Space | null = null;
let clouds: Record<string, CloudPoint> = {};
let cloudAsked = false;
let lastFetch = 0;
let busy = false;
let again = false;

// ---------- small DOM helpers ----------

type Kid = Node | string | null | undefined | false;

function el(tag: string, attrs: Record<string, string | undefined> = {}, ...kids: Kid[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(name, value);
  for (const kid of kids) if (kid) node.append(kid);
  return node;
}

function slot(root: ParentNode, name: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-slot="${name}"]`);
}

function put(root: ParentNode, name: string, text: string): void {
  const node = slot(root, name);
  // Leave unchanged text alone so screen readers are not told the same thing every minute.
  if (node && node.textContent !== text) node.textContent = text;
}

function fill(root: ParentNode, name: string, ...kids: Kid[]): void {
  const node = slot(root, name);
  if (node) node.replaceChildren(...(kids.filter(Boolean) as Array<Node | string>));
}

function readPlace(node: HTMLElement): Place | null {
  try {
    return node.dataset.place ? (JSON.parse(node.dataset.place) as Place) : null;
  } catch {
    return null;
  }
}

// ---------- time formatting in the place's own zone ----------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(kind: string, tz: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${kind}|${tz ?? ''}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-AU', { ...options, timeZone: tz });
    } catch {
      f = new Intl.DateTimeFormat('en-AU', options);
    }
    formatters.set(key, f);
  }
  return f;
}

const tidy = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ').replace(',', '');

function clock(ms: number, tz?: string): string {
  return tidy(formatter('clock', tz, { hour: 'numeric', minute: '2-digit', hour12: true }).format(ms));
}

/** "10 pm" on the hour, "10:30 pm" in half-hour zones. */
function hourLabel(ms: number, tz?: string): string {
  const text = clock(ms, tz);
  return text.replace(':00', '');
}

function dayLabel(ms: number, tz?: string): string {
  return tidy(formatter('day', tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(ms));
}

function weekday(ms: number, tz?: string): string {
  return formatter('weekday', tz, { weekday: 'long' }).format(ms);
}

function span(a: number, b: number, tz?: string): string {
  return `${hourLabel(a, tz)} to ${hourLabel(b, tz)}`;
}

/** Calendar date, YYYY-MM-DD, in the place's own zone. */
function localDate(ms: number, tz?: string): string {
  const parts = formatter('ymd', tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "in Hobart", but "at your spot" for a visitor's own coordinates. */
function where(place: Place): string {
  return `${place.tz ? 'in' : 'at'} ${place.name}`;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function nightName(view: NightView, index: number, tz?: string): string {
  if (index === 0) return 'Tonight';
  // Name the night after the evening it starts on, even when full darkness begins after midnight.
  return `${weekday(view.night.start - 8 * HOUR, tz)} night`;
}

// ---------- loading ----------

async function grab(url: string, kind: 'json' | 'text'): Promise<unknown> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: control.signal });
    if (!response.ok) return null;
    return kind === 'json' ? await response.json() : await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadSpace(previous: Space | null): Promise<Space> {
  const [kpRaw, forecastRaw, windRaw, hemiRaw, outlookRaw] = await Promise.all([
    grab(NOAA_URLS.kpNow, 'json'),
    grab(NOAA_URLS.kpForecast, 'json'),
    grab(NOAA_URLS.solarWind, 'json'),
    grab(NOAA_URLS.hemiPower, 'text'),
    grab(NOAA_URLS.outlook27, 'text'),
  ]);
  let wind = parseSolarWind(windRaw);
  if (!wind) {
    const [mag, speed] = await Promise.all([grab(NOAA_URLS.magSummary, 'json'), grab(NOAA_URLS.speedSummary, 'json')]);
    wind = parseWindSummary(mag, speed);
  }
  const blocks = parseKpForecast(forecastRaw);
  const outlook = parseOutlook27(outlookRaw);
  // Anything that failed this round keeps its last good value; each reading carries its own time.
  return {
    fetched: Date.now(),
    kpNow: parseKpNow(kpRaw) ?? previous?.kpNow ?? null,
    blocks: blocks.length ? blocks : (previous?.blocks ?? []),
    wind: wind ?? previous?.wind ?? null,
    hemi: parseHemiPower(hemiRaw) ?? previous?.hemi ?? null,
    outlook: outlook.days.length ? outlook : (previous?.outlook ?? outlook),
  };
}

// ---------- pieces of the page ----------

function pill(verdict: Verdict | null, text?: string): HTMLElement {
  return el('span', { class: 'pill', 'data-verdict': verdict ?? 'none' }, text ?? (verdict ? VERDICT_LABEL[verdict] : 'No data'));
}

const ACTIVITY_TONE: Record<Activity, string> = { overhead: 'go', visible: 'go', close: 'maybe', faint: 'no', quiet: 'no' };

function kpCell(s: Slot): HTMLElement {
  if (s.kp === null) return el('td', {}, '–');
  const tag = s.source === 'live' ? ' live' : s.source === 'outlook' ? ' daily' : '';
  return el(
    'td',
    {},
    el('span', { class: 'kp', 'data-tone': s.assessment ? ACTIVITY_TONE[s.assessment.activity] : 'no' }, kpText(s.kp)),
    tag ? el('span', { class: 'tag' }, tag.trim()) : null,
  );
}

function cloudCell(pct: number | null): HTMLElement {
  if (pct === null) return el('td', { class: 'muted' }, 'no data');
  return el('td', {}, `${Math.round(pct)}%`, el('span', { class: 'cloudbar', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.round(pct)}%` })));
}

function cloudRange(view: NightView): string {
  if (view.cloudMin === null || view.cloudMax === null) return 'no data';
  const lo = Math.round(view.cloudMin);
  const hi = Math.round(view.cloudMax);
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
}

/** The hours behind a verdict, trimmed to the dark period and to what is still ahead. */
function windowText(view: NightView, now: number, tz?: string): string {
  return view.windows
    .map(([a, b]) => span(Math.max(a, view.night.start, Math.min(now, b)), Math.min(b, view.night.end), tz))
    .join(' and ');
}

function moonText(view: NightView, tz?: string): string {
  const lit = `${Math.round(view.moon.fraction * 100)}% lit`;
  const { upShare, rises, sets } = view.moon;
  if (upShare === 0) return `Moon ${lit}, below the horizon all night.`;
  if (upShare === 1) return `Moon ${lit}, up all night.`;
  if (sets !== null && rises === null) return `Moon ${lit}, sets about ${clock(sets, tz)}.`;
  if (rises !== null && sets === null) return `Moon ${lit}, rises about ${clock(rises, tz)}.`;
  return `Moon ${lit}, up for part of the night.`;
}

function renderHeadline(root: HTMLElement, place: Place, a: Analysis): void {
  const box = slot(root, 'verdict');
  if (!box) return;
  const tonight = a.nights[0];
  const notes: string[] = [];
  const set = (verdict: Verdict | 'none', kicker: string, word: string, why: string, next: string) => {
    box.dataset.verdict = verdict;
    put(box, 'kicker', kicker);
    put(box, 'word', word);
    put(box, 'why', why);
    const nextNode = slot(box, 'next');
    if (nextNode) {
      if (nextNode.textContent !== next) nextNode.textContent = next;
      nextNode.hidden = !next;
    }
    const list = slot(box, 'notes');
    if (list && list.dataset.sig !== notes.join('|')) {
      list.dataset.sig = notes.join('|');
      list.replaceChildren(...notes.map((note) => el('li', {}, note)));
      list.hidden = notes.length === 0;
    }
  };

  if (!tonight) {
    set('none', capital(place.name), 'No answer', 'No night could be worked out for this spot. This tool covers Australia and New Zealand.', '');
    return;
  }
  const head = a.darkNow && a.current ? a.current : tonight.best;
  if (tonight.night.twilightOnly) notes.push('The sky does not get fully dark here tonight, so only a strong display will show.');
  if (tonight.moon.fraction >= 0.6 && tonight.moon.upShare >= 0.3) {
    notes.push(`The moon is ${Math.round(tonight.moon.fraction * 100)}% lit and up for much of the night. It washes out faint aurora.`);
  }
  const cloudPoint = clouds[pointKey(place.lat, place.lon)];
  if (cloudPoint?.stale) notes.push('The cloud forecast could not be refreshed, so an older copy is being used.');
  if (a.darkNow && a.current && a.current.source !== 'live') {
    notes.push("NOAA's live Kp is delayed, so this uses the forecast for this hour instead.");
  }
  if (head?.source === 'outlook') notes.push("This night is past NOAA's 3-day forecast. It uses the daily peak from the 27-day outlook, which is far less certain.");

  if (!head || !head.assessment || head.kp === null) {
    const kicker = a.darkNow ? `Right now ${where(place)}` : `Tonight ${where(place)}`;
    set('none', kicker, 'No answer yet', "NOAA's Kp data could not be loaded. Try again in a few minutes.", '');
    return;
  }

  const sentence = explain(head.assessment, {
    name: place.name,
    kp: head.kp,
    live: head.source === 'live',
    need: place.kpVisible,
    cloud: head.cloud,
    when: hourLabel(head.start, place.tz),
    bearing: place.bearing,
  });
  const label = VERDICT_LABEL[head.assessment.verdict];

  if (a.darkNow && a.current) {
    let next = '';
    if (tonight.verdict && tonight.verdict !== 'no') {
      next = `Rest of tonight: ${VERDICT_LABEL[tonight.verdict].toLowerCase()} from ${windowText(tonight, a.now, place.tz)}.`;
    } else if (tonight.slots.length > 1) {
      next = 'Rest of tonight: nothing better in the forecast.';
    }
    set(head.assessment.verdict, `Right now ${where(place)} · ${clock(a.now, place.tz)}`, label, sentence, next);
  } else {
    const dark = `dark from ${clock(tonight.night.start, place.tz)} to ${clock(tonight.night.end, place.tz)}`;
    const next = tonight.verdict && tonight.verdict !== 'no' ? `Best window: ${windowText(tonight, a.now, place.tz)}. Check again before you leave: aurora comes in bursts.` : '';
    set(head.assessment.verdict, `Tonight ${where(place)} · ${dark}`, label, sentence, next);
  }
}

function renderChecks(root: HTMLElement, place: Place, a: Analysis): void {
  const tonight = a.nights[0];
  const need = place.kpVisible === null ? 'more than Kp 9' : `Kp ${place.kpVisible}`;
  const live = space?.kpNow;
  put(root, 'activity-main', live ? `Kp ${kpText(live.kp)} now` : 'Kp unavailable');
  let activitySub = `${capital(place.name)} needs ${need}.`;
  if (tonight && tonight.peakKp !== null && tonight.peakKpAt !== null) {
    activitySub += tonight.kpSource === 'outlook'
      ? ` Daily outlook peak: Kp ${kpText(tonight.peakKp)}.`
      : ` Forecast peak tonight: Kp ${kpText(tonight.peakKp)} around ${hourLabel(tonight.peakKpAt, place.tz)}.`;
  }
  put(root, 'activity-sub', activitySub);

  if (!tonight || tonight.cloudMin === null) {
    put(root, 'sky-main', 'Cloud forecast unavailable');
    put(root, 'sky-sub', cloudAsked ? 'Look outside, or check your usual weather service.' : 'Loading…');
  } else {
    put(root, 'sky-main', `${cloudRange(tonight)} cloud tonight`);
    const clearest = [...tonight.slots].filter((s) => s.cloud !== null).sort((x, y) => (x.cloud as number) - (y.cloud as number))[0];
    put(root, 'sky-sub', clearest ? `Clearest around ${hourLabel(clearest.start, place.tz)}: ${cloudWord(clearest.cloud as number)}.` : '');
  }

  if (!tonight) {
    put(root, 'dark-main', 'No night found');
    put(root, 'dark-sub', '');
  } else {
    const kind = tonight.night.twilightOnly ? 'Twilight only' : 'Fully dark';
    put(root, 'dark-main', `${kind} ${clock(tonight.night.start, place.tz)} to ${clock(tonight.night.end, place.tz)}`);
    put(root, 'dark-sub', `${durationText(tonight.night.end - tonight.night.start)}. ${moonText(tonight, place.tz)}`);
  }
}

function renderHours(root: HTMLElement, place: Place, a: Analysis): void {
  const body = slot(root, 'hours');
  if (!body) return;
  const tonight = a.nights[0];
  if (!tonight || tonight.slots.length === 0) {
    body.replaceChildren(el('tr', {}, el('td', { colspan: '5', class: 'muted' }, 'No dark hours left tonight.')));
    return;
  }
  body.replaceChildren(
    ...tonight.slots.map((s) => {
      const moonUp = moonAltitudeDeg(s.start + HOUR / 2, place.lat, place.lon) > 0;
      const current = a.now >= s.start && a.now < s.start + HOUR;
      return el(
        'tr',
        current ? { class: 'current' } : {},
        el('th', { scope: 'row' }, hourLabel(s.start, place.tz), current ? el('span', { class: 'tag' }, 'now') : null),
        kpCell(s),
        cloudCell(s.cloud),
        el('td', { class: moonUp ? '' : 'muted' }, moonUp ? 'up' : 'down'),
        el('td', {}, pill(s.assessment?.verdict ?? null)),
      );
    }),
  );
}

function renderNights(root: HTMLElement, place: Place, a: Analysis): void {
  const body = slot(root, 'nights');
  if (!body) return;
  if (a.nights.length === 0) {
    body.replaceChildren(el('tr', {}, el('td', { colspan: '4', class: 'muted' }, 'No nights to show.')));
    return;
  }
  body.replaceChildren(
    ...a.nights.map((view, index) => {
      const when = view.verdict && view.verdict !== 'no' ? el('span', { class: 'when' }, windowText(view, a.now, place.tz)) : null;
      return el(
        'tr',
        { role: 'row' },
        el(
          'th',
          { scope: 'row', role: 'rowheader' },
          nightName(view, index, place.tz),
          el('span', { class: 'sub' }, dayLabel(view.night.start - 8 * HOUR, place.tz)),
          el('span', { class: 'sub' }, `dark ${clock(view.night.start, place.tz)} to ${clock(view.night.end, place.tz)}`),
        ),
        el(
          'td',
          { role: 'cell', 'data-label': 'Peak Kp' },
          view.peakKp === null ? '–' : kpText(view.peakKp),
          view.kpSource === 'outlook' ? el('span', { class: 'tag' }, 'daily') : null,
        ),
        el('td', { role: 'cell', 'data-label': 'Cloud' }, cloudRange(view)),
        el('td', { role: 'cell', 'data-slot': 'verdict' }, pill(view.verdict), when),
      );
    }),
  );
}

function renderOutlook(list: HTMLElement, note: HTMLElement | null, place: Place | null, now: number): void {
  if (!space || space.outlook.days.length === 0) {
    list.replaceChildren(el('li', { class: 'muted' }, "NOAA's 27-day outlook could not be loaded."));
    return;
  }
  // A UTC day in the outlook covers the night that starts on the same calendar date in Australia and
  // New Zealand. Six hours back keeps the night in progress on show until morning.
  const tonight = localDate(now - 6 * HOUR, place?.tz);
  const days = outlookFor(place ?? { kpFaint: null, kpVisible: 5, kpOverhead: null }, space.outlook, tonight);
  list.replaceChildren(
    ...days.map((day) => {
      const date = Date.parse(`${day.date}T12:00:00Z`);
      const label = tidy(new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date));
      const tone = place ? ACTIVITY_TONE[day.activity] : day.level >= 5 ? 'go' : day.level === 4 ? 'maybe' : 'no';
      return el('li', { 'data-tone': tone }, el('span', { class: 'day' }, label), ' ', el('strong', {}, `Kp ${day.kp}`));
    }),
  );
  if (note) {
    const m = /^(\d{4}) (\w{3}) (\d{1,2}) (\d{2})(\d{2}) UTC$/.exec(space.outlook.issued ?? '');
    note.textContent = m ? `Issued by NOAA on ${Number(m[3])} ${m[2]} ${m[1]} at ${m[4]}:${m[5]} UTC.` : '';
  }
}

function renderPlace(root: HTMLElement, now: number): void {
  const place = readPlace(root);
  if (!place || !space) return;
  const cloud = clouds[pointKey(place.lat, place.lon)] ?? null;
  const a = analyse(place, space, cloud, now, 3);
  renderHeadline(root, place, a);
  renderChecks(root, place, a);
  renderHours(root, place, a);
  renderNights(root, place, a);
  const list = slot(root, 'outlook');
  if (list) renderOutlook(list, slot(root, 'outlook-note'), place, now);
  const parts = [`Checked ${clock(now, place.tz)}`];
  if (space.kpNow) parts.push(`Kp reading from ${agoText(space.kpNow.time, now)}`);
  if (cloud?.updated) parts.push(`cloud forecast issued ${agoText(Date.parse(cloud.updated), now)}`);
  put(root, 'stamp', `${parts.join(' · ')}. Times are local to ${place.tz ? place.name : 'your device'}.`);
}

function renderRow(row: HTMLElement, now: number): void {
  const place = readPlace(row);
  if (!place || !space) return;
  const cloud = clouds[pointKey(place.lat, place.lon)] ?? null;
  const a = analyse(place, space, cloud, now, 1);
  const tonight = a.nights[0];
  if (!tonight) return;
  fill(
    row,
    'kp',
    tonight.peakKp === null ? '–' : el('span', { class: 'kp', 'data-tone': tonight.best?.assessment ? ACTIVITY_TONE[tonight.best.assessment.activity] : 'no' }, kpText(tonight.peakKp)),
  );
  put(row, 'cloud', tonight.cloudMin === null ? (cloudAsked ? 'no data' : '…') : cloudRange(tonight));
  const when = tonight.verdict && tonight.verdict !== 'no' ? el('span', { class: 'when' }, windowText(tonight, now, place.tz)) : null;
  fill(row, 'verdict', pill(tonight.verdict), when);
}

function sparkline(samples: Array<{ time: number; bz: number | null }>): SVGElement | null {
  const points = samples.filter((s) => s.bz !== null) as Array<{ time: number; bz: number }>;
  if (points.length < 8) return null;
  const ns = 'http://www.w3.org/2000/svg';
  const w = 300;
  const h = 60;
  const t0 = points[0].time;
  const t1 = points[points.length - 1].time;
  const reach = Math.max(5, ...points.map((p) => Math.abs(p.bz)));
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * w;
  const y = (v: number) => h / 2 - (v / reach) * (h / 2 - 3);
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Bz over the last hour, between ${Math.min(...points.map((p) => p.bz)).toFixed(1)} and ${Math.max(...points.map((p) => p.bz)).toFixed(1)} nT`);
  const zero = document.createElementNS(ns, 'line');
  zero.setAttribute('x1', '0');
  zero.setAttribute('x2', String(w));
  zero.setAttribute('y1', String(h / 2));
  zero.setAttribute('y2', String(h / 2));
  zero.setAttribute('class', 'zero');
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', points.map((p) => `${x(p.time).toFixed(1)},${y(p.bz).toFixed(1)}`).join(' '));
  line.setAttribute('class', 'trace');
  svg.append(zero, line);
  return svg;
}

function renderSpace(root: HTMLElement, now: number): void {
  if (!space) return;
  const { kpNow, wind, hemi } = space;
  put(root, 'kp', kpNow ? kpText(kpNow.kp) : '–');
  put(root, 'kp-note', kpNow ? `${kpWord(kpNow.kp)} · ${agoText(kpNow.time, now)}` : 'unavailable');
  put(root, 'bz', wind && wind.bz !== null ? `${wind.bz > 0 ? '+' : ''}${wind.bz.toFixed(1)} nT` : '–');
  let bzNote = wind && wind.bz !== null ? bzWord(wind.bz) : 'unavailable';
  if (wind && wind.southMinutes30 !== null && wind.series.length >= 20) bzNote += ` · south for ${wind.southMinutes30} of the last 30 min`;
  put(root, 'bz-note', bzNote);
  put(root, 'speed', wind && wind.speed !== null ? `${Math.round(wind.speed)} km/s` : '–');
  let speedNote = wind && wind.speed !== null ? speedWord(wind.speed) : 'unavailable';
  if (wind && wind.density !== null) speedNote += ` · density ${wind.density.toFixed(1)} per cm³`;
  put(root, 'speed-note', speedNote);
  put(root, 'power', hemi && hemi.south !== null ? `${Math.round(hemi.south)} GW` : '–');
  put(root, 'power-note', hemi && hemi.south !== null ? `${powerWord(hemi.south)} · southern hemisphere` : 'unavailable');

  const lead = slot(root, 'lead');
  if (lead) {
    if (wind && wind.arrival !== null && wind.arrival > now) {
      lead.textContent = `The solar wind measured ${agoText(wind.time, now)} reaches Earth in about ${durationText(wind.arrival - now)}.`;
    } else if (wind) {
      lead.textContent = `Solar wind measured ${agoText(wind.time, now)}, about 1.5 million km upstream of Earth.`;
    } else {
      lead.textContent = '';
    }
  }
  const figure = slot(root, 'spark');
  if (figure) {
    const chart = wind ? sparkline(wind.series) : null;
    const holder = slot(figure, 'spark-chart');
    if (chart && holder) {
      holder.replaceChildren(chart);
      figure.hidden = false;
    } else {
      figure.hidden = true;
    }
  }
  const stale = !kpNow || now - kpNow.time > 45 * 60 * 1000;
  put(root, 'stamp', stale ? 'NOAA data is delayed or unavailable right now. Readings may be out of date.' : `Checked ${clock(now)} your time. Refreshes every 5 minutes.`);
  root.dataset.state = stale ? 'stale' : 'ok';
}

// ---------- the visitor's own coordinates ----------

function customPlace(lat: number, lon: number): Place | null {
  const mlat = mlatFromGrid(grid, lat, lon);
  if (mlat === null) return null;
  return {
    name: 'your spot',
    lat: Math.round(lat * 100) / 100,
    lon: Math.round(lon * 100) / 100,
    mlat: Math.round(mlat * 10) / 10,
    bearing: bearingFromGrid(grid, lat, lon),
    ...thresholdsFor(Math.abs(mlat)),
  };
}

function setupCustom(panel: HTMLElement): void {
  const dash = document.querySelector<HTMLElement>('[data-aurora="place"]');
  const status = slot(panel, 'status');
  const facts = slot(panel, 'facts');
  const forget = slot(panel, 'forget');
  const say = (text: string) => {
    if (status) status.textContent = text;
  };

  const show = (lat: number, lon: number, save: boolean) => {
    const place = customPlace(lat, lon);
    if (!place || !dash) {
      say('That spot is outside the area this tool covers (Australia, New Zealand and nearby islands).');
      return;
    }
    if (save) {
      try {
        localStorage.setItem(CUSTOM_KEY, JSON.stringify({ lat: place.lat, lon: place.lon }));
      } catch {
        // Not being able to remember the spot is fine.
      }
    }
    dash.dataset.place = JSON.stringify(place);
    dash.hidden = false;
    if (forget) forget.hidden = false;
    const need = place.kpVisible === null ? 'more than Kp 9' : `Kp ${place.kpVisible}`;
    if (facts) {
      facts.textContent = `Using ${Math.abs(place.lat).toFixed(2)}°S, ${place.lon.toFixed(2)}°E (rounded to about 1 km). Magnetic latitude ${Math.abs(place.mlat).toFixed(1)}°S. A display you can see needs ${need}.`;
      facts.hidden = false;
    }
    say('');
    void refresh(true);
  };

  slot(panel, 'locate')?.addEventListener('click', () => {
    if (!('geolocation' in navigator)) {
      say('This browser cannot share a location. Type your coordinates instead.');
      return;
    }
    say('Asking your browser for your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => show(pos.coords.latitude, pos.coords.longitude, true),
      () => say('Location was not shared. You can type coordinates instead.'),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  });

  panel.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const lat = Number((slot(panel, 'lat') as HTMLInputElement | null)?.value);
    const lon = Number((slot(panel, 'lon') as HTMLInputElement | null)?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0) {
      say('Enter a latitude such as -42.88 and a longitude such as 147.33.');
      return;
    }
    show(lat > 0 ? -lat : lat, lon, true);
  });

  forget?.addEventListener('click', () => {
    try {
      localStorage.removeItem(CUSTOM_KEY);
    } catch {
      // Nothing was stored.
    }
    if (dash) {
      dash.hidden = true;
      delete dash.dataset.place;
    }
    if (facts) facts.hidden = true;
    forget.hidden = true;
    panel.querySelector('form')?.reset();
    say('Your spot has been forgotten on this device.');
  });

  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? 'null') as { lat: number; lon: number } | null;
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) show(saved.lat, saved.lon, false);
  } catch {
    // No saved spot.
  }
}

// ---------- driving it ----------

function places(): Place[] {
  const out: Place[] = [];
  document.querySelectorAll<HTMLElement>('[data-aurora="place"], [data-aurora="row"]').forEach((node) => {
    const place = readPlace(node);
    if (place) out.push(place);
  });
  return out;
}

/** `spaceOnly` draws just the readings that do not depend on a place, while the cloud forecast is still loading. */
function draw(spaceOnly = false): void {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>('[data-aurora="space"]').forEach((node) => renderSpace(node, now));
  if (!spaceOnly) {
    document.querySelectorAll<HTMLElement>('[data-aurora="place"]').forEach((node) => renderPlace(node, now));
    document.querySelectorAll<HTMLElement>('[data-aurora="row"]').forEach((node) => renderRow(node, now));
  }
  document.querySelectorAll<HTMLElement>('[data-aurora="outlook"]').forEach((node) => {
    const list = slot(node, 'outlook');
    if (list) renderOutlook(list, slot(node, 'outlook-note'), null, now);
  });
}

async function refresh(force = false): Promise<void> {
  if (busy) {
    // A place was added while a refresh was running: go round once more when it finishes.
    if (force) again = true;
    return;
  }
  if (!force && Date.now() - lastFetch < REFRESH_MS - 5000) return;
  busy = true;
  try {
    const wanted = places();
    const first = !cloudAsked;
    // Space weather usually lands first. Show it straight away; hold the verdicts until the cloud
    // forecast has had its chance, so the page never flashes an answer it is about to change.
    const spaceJob = loadSpace(space).then((fresh) => {
      space = fresh;
      draw(first);
    });
    const cloudJob = wanted.length
      ? fetchCloud(wanted).then((fresh) => {
          clouds = { ...clouds, ...fresh };
        })
      : Promise.resolve();
    await Promise.all([spaceJob, cloudJob]);
    cloudAsked = true;
    lastFetch = Date.now();
    draw();
  } finally {
    busy = false;
    if (again) {
      again = false;
      void refresh(true);
    }
  }
}

function start(): void {
  const customPanel = document.querySelector<HTMLElement>('[data-aurora="custom"]');
  if (customPanel) setupCustom(customPanel);
  document.querySelectorAll<HTMLSelectElement>('[data-aurora="jump"]').forEach((select) => {
    select.addEventListener('change', () => {
      if (select.value) window.location.href = select.value;
    });
  });
  void refresh(true);
  setInterval(() => {
    if (!document.hidden) void refresh();
  }, REFRESH_MS);
  setInterval(() => {
    if (!document.hidden && space) draw();
  }, REDRAW_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
