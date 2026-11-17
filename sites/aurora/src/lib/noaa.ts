// Parsers for the NOAA Space Weather Prediction Center products the site reads.
// Formats were checked against the live services on 17 November 2026.

const BASE = 'https://services.swpc.noaa.gov';

export const NOAA_URLS = {
  kpNow: `${BASE}/json/planetary_k_index_1m.json`,
  kpForecast: `${BASE}/products/noaa-planetary-k-index-forecast.json`,
  solarWind: `${BASE}/products/geospace/propagated-solar-wind-1-hour.json`,
  magSummary: `${BASE}/products/summary/solar-wind-mag-field.json`,
  speedSummary: `${BASE}/products/summary/solar-wind-speed.json`,
  hemiPower: `${BASE}/text/aurora-nowcast-hemi-power.txt`,
  outlook27: `${BASE}/text/27-day-outlook.txt`,
};

/** NOAA time tags are UTC but often omit the zone. */
export function parseUtc(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  let s = value.trim().replace(' ', 'T');
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += 'Z';
  return Date.parse(s);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface KpNow {
  kp: number;
  time: number;
}

/** Latest one-minute estimated planetary Kp. */
export function parseKpNow(json: unknown): KpNow | null {
  if (!Array.isArray(json)) return null;
  for (let i = json.length - 1; i >= 0; i--) {
    const row = json[i] as Record<string, unknown> | null;
    const kp = num(row?.estimated_kp);
    const time = parseUtc(row?.time_tag);
    if (kp !== null && kp >= 0 && kp <= 9 && Number.isFinite(time)) return { kp, time };
  }
  return null;
}

export interface KpBlock {
  /** Start of the three-hour block, ms since epoch. */
  start: number;
  end: number;
  kp: number;
  kind: 'observed' | 'estimated' | 'predicted';
  scale: string | null;
}

/** Three-hourly observed, estimated and predicted Kp. */
export function parseKpForecast(json: unknown): KpBlock[] {
  if (!Array.isArray(json)) return [];
  const out: KpBlock[] = [];
  for (const raw of json) {
    let time: unknown;
    let kpRaw: unknown;
    let kind: unknown;
    let scale: unknown;
    if (Array.isArray(raw)) {
      // Older layout: rows of [time_tag, kp, observed, noaa_scale] under a header row.
      [time, kpRaw, kind, scale] = raw;
    } else if (raw && typeof raw === 'object') {
      const row = raw as Record<string, unknown>;
      time = row.time_tag;
      kpRaw = row.kp;
      kind = row.observed;
      scale = row.noaa_scale;
    }
    const start = parseUtc(time);
    const kp = num(kpRaw);
    if (!Number.isFinite(start) || kp === null || kp < 0 || kp > 9) continue;
    const k = kind === 'observed' || kind === 'estimated' ? kind : 'predicted';
    out.push({ start, end: start + 3 * 3600000, kp, kind: k, scale: typeof scale === 'string' && scale ? scale : null });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function kpForTime(blocks: KpBlock[], ms: number): KpBlock | null {
  for (const block of blocks) if (ms >= block.start && ms < block.end) return block;
  return null;
}

export interface WindSample {
  time: number;
  bz: number | null;
  speed: number | null;
}

export interface SolarWind {
  /** When the latest sample was measured upstream of Earth. */
  time: number;
  bz: number | null;
  bt: number | null;
  speed: number | null;
  density: number | null;
  /** When NOAA expects that sample to reach Earth, if given. */
  arrival: number | null;
  /** Mean Bz and minutes of southward Bz over the last half hour of samples. */
  bzMean30: number | null;
  southMinutes30: number | null;
  series: WindSample[];
}

/** One hour of solar wind, propagated to Earth: rows under a header row. */
export function parseSolarWind(json: unknown): SolarWind | null {
  if (!Array.isArray(json) || json.length < 2 || !Array.isArray(json[0])) return null;
  const header = (json[0] as unknown[]).map((h) => String(h));
  const col = (name: string) => header.indexOf(name);
  const iTime = col('time_tag');
  const iBz = col('bz');
  if (iTime < 0 || iBz < 0) return null;
  const iBt = col('bt');
  const iSpeed = col('speed');
  const iDensity = col('density');
  const iArrival = col('propagated_time_tag');
  const rows: Array<{ time: number; bz: number | null; bt: number | null; speed: number | null; density: number | null; arrival: number | null }> = [];
  for (const raw of json.slice(1)) {
    if (!Array.isArray(raw)) continue;
    const time = parseUtc(raw[iTime]);
    if (!Number.isFinite(time)) continue;
    const arrival = iArrival >= 0 ? parseUtc(raw[iArrival]) : NaN;
    rows.push({
      time,
      bz: num(raw[iBz]),
      bt: iBt >= 0 ? num(raw[iBt]) : null,
      speed: iSpeed >= 0 ? num(raw[iSpeed]) : null,
      density: iDensity >= 0 ? num(raw[iDensity]) : null,
      arrival: Number.isFinite(arrival) ? arrival : null,
    });
  }
  rows.sort((a, b) => a.time - b.time);
  const latest = [...rows].reverse().find((r) => r.bz !== null || r.speed !== null);
  if (!latest) return null;
  const recent = rows.filter((r) => r.time > latest.time - 30 * 60000 && r.bz !== null);
  const bzMean30 = recent.length ? recent.reduce((s, r) => s + (r.bz as number), 0) / recent.length : null;
  return {
    time: latest.time,
    bz: latest.bz,
    bt: latest.bt,
    speed: latest.speed,
    density: latest.density,
    arrival: latest.arrival,
    bzMean30,
    southMinutes30: recent.length ? recent.filter((r) => (r.bz as number) < 0).length : null,
    series: rows.map((r) => ({ time: r.time, bz: r.bz, speed: r.speed })),
  };
}

/** Fallback when the one-hour product is unavailable: the single-value summaries. */
export function parseWindSummary(mag: unknown, speed: unknown): SolarWind | null {
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | null | undefined;
  const m = first(mag);
  const s = first(speed);
  const bz = num(m?.bz_gsm ?? m?.Bz);
  const bt = num(m?.bt ?? m?.Bt);
  const sp = num(s?.proton_speed ?? s?.WindSpeed);
  const time = parseUtc(m?.time_tag ?? m?.TimeStamp ?? s?.time_tag ?? s?.TimeStamp);
  if ((bz === null && sp === null) || !Number.isFinite(time)) return null;
  return { time, bz, bt, speed: sp, density: null, arrival: null, bzMean30: null, southMinutes30: null, series: [] };
}

export interface HemiPower {
  /** When the driving solar wind was observed. */
  observed: number;
  /** When the forecast is valid for. */
  valid: number;
  north: number | null;
  south: number | null;
}

/** Last row of the OVATION hemispheric power table. */
export function parseHemiPower(text: unknown): HemiPower | null {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith(':')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const observed = parseUtc(parts[0].replace('_', 'T'));
    const valid = parseUtc(parts[1].replace('_', 'T'));
    const south = num(parts[3]);
    if (!Number.isFinite(observed) || south === null) continue;
    return { observed, valid: Number.isFinite(valid) ? valid : observed, north: num(parts[2]), south };
  }
  return null;
}

export interface OutlookDay {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  kp: number;
}

export interface Outlook27 {
  issued: string | null;
  days: OutlookDay[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The 27-day outlook table: one line per UTC day with the largest expected Kp. */
export function parseOutlook27(text: unknown): Outlook27 {
  const out: Outlook27 = { issued: null, days: [] };
  if (typeof text !== 'string') return out;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith(':Issued:')) out.issued = line.slice(8).trim();
    const m = /^(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)$/.exec(line);
    if (!m) continue;
    const month = MONTHS.indexOf(m[2]);
    const kp = Number(m[6]);
    if (month < 0 || !(kp >= 0 && kp <= 9)) continue;
    out.days.push({ date: `${m[1]}-${String(month + 1).padStart(2, '0')}-${m[3].padStart(2, '0')}`, kp });
  }
  return out;
}
