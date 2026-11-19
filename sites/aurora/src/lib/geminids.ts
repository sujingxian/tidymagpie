// Live part of the Geminids page: the cloud forecast for each place's watch window.
// Everything else on the page is worked out when the site is built.
import { cloudAt, fetchCloud, pointKey, type CloudPoint } from './cloud.ts';
import { skyFor } from './model.ts';

interface Watch {
  start: number;
  end: number;
}

interface Row {
  node: HTMLElement;
  lat: number;
  lon: number;
  watches: Array<Watch | null>;
}

const HOUR = 3600000;
/** The cloud proxy passes on 96 hours of forecast. Ask a little before the first watch comes into range. */
const LOOKAHEAD_MS = 96 * HOUR;
const REFRESH_MS = 30 * 60 * 1000;

function readRows(): Row[] {
  const rows: Row[] = [];
  document.querySelectorAll<HTMLElement>('[data-geminid]').forEach((node) => {
    try {
      const data = JSON.parse(node.dataset.geminid ?? '') as { lat: number; lon: number; watches: Array<Watch | null> };
      if (Number.isFinite(data.lat) && Number.isFinite(data.lon) && Array.isArray(data.watches)) rows.push({ node, ...data });
    } catch {
      // A row without data keeps its built-in text.
    }
  });
  return rows;
}

/** Average total cloud over the hours of one watch, or null if the forecast does not cover all of them. */
export function watchCloud(point: CloudPoint | null | undefined, watch: Watch): number | null {
  const readings: number[] = [];
  for (let t = Math.floor(watch.start / HOUR) * HOUR; t < watch.end; t += HOUR) {
    // The middle of each hour, kept inside the watch so a part hour is read at its own time.
    const reading = cloudAt(point, Math.min(Math.max(t + HOUR / 2, watch.start), watch.end));
    if (!reading) return null;
    readings.push(reading.total);
  }
  if (!readings.length) return null;
  return Math.round(readings.reduce((a, b) => a + b, 0) / readings.length);
}

const LABEL = { clear: 'Clear', partly: 'Some cloud', cloudy: 'Cloudy' } as const;
const TONE = { clear: 'go', partly: 'maybe', cloudy: 'no' } as const;

function paint(row: Row, clouds: Record<string, CloudPoint>, now: number): void {
  const point = clouds[pointKey(row.lat, row.lon)];
  row.node.querySelectorAll<HTMLElement>('[data-night]').forEach((cell) => {
    const index = Number(cell.dataset.night);
    const watch = row.watches[index];
    const pill = cell.querySelector<HTMLElement>('.pill');
    const note = cell.querySelector<HTMLElement>('.when');
    if (!pill || !watch) return;
    if (now > watch.end) {
      pill.dataset.verdict = 'none';
      pill.textContent = 'Over';
      if (note) note.textContent = '';
      return;
    }
    const pct = watchCloud(point, watch);
    if (pct === null) return; // keep "Forecast from …"
    const sky = skyFor(pct);
    if (sky === 'unknown') return;
    pill.dataset.verdict = TONE[sky];
    pill.textContent = LABEL[sky];
    if (note) note.textContent = `${pct}% cloud`;
  });
}

async function run(): Promise<void> {
  const rows = readRows();
  if (!rows.length) return;
  const now = Date.now();
  const starts = rows.flatMap((r) => r.watches.filter((w): w is Watch => w !== null).map((w) => w.start));
  const ends = rows.flatMap((r) => r.watches.filter((w): w is Watch => w !== null).map((w) => w.end));
  const first = Math.min(...starts);
  const last = Math.max(...ends);
  if (now > last) {
    rows.forEach((row) => paint(row, {}, now));
    document.querySelectorAll<HTMLElement>('[data-geminid-over]').forEach((node) => (node.hidden = false));
    return;
  }
  if (now < first - LOOKAHEAD_MS) return;
  const clouds = await fetchCloud(rows);
  const stamp = Date.now();
  rows.forEach((row) => paint(row, clouds, stamp));
  document.querySelectorAll<HTMLElement>('[data-geminid-live]').forEach((node) => (node.hidden = false));
}

function start(): void {
  void run();
  setInterval(() => {
    if (!document.hidden) void run();
  }, REFRESH_MS);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
