// The go / maybe / no-go rules. Pure functions, no browser APIs, so they can be unit tested.
// Every number here is explained on the "How it works" page.

/** Equatorward edge of the aurora, in magnetic latitude, for Kp 0 to 9 (NOAA SWPC). */
export const KP_BOUNDARY = [66.5, 64.5, 62.4, 60.4, 58.3, 56.3, 54.2, 52.2, 50.1, 48.1];
/** NOAA: aurora is easily visible when its edge is 4 to 5 degrees poleward of you. */
export const EASY_MARGIN_DEG = 5;
/** NOAA: aurora can be seen from as much as 1000 km away (about 9 degrees of latitude). */
export const FAR_MARGIN_DEG = 9;

/** Cloud cover at or below this is treated as clear enough. */
export const CLEAR_MAX_PCT = 30;
/** Cloud cover above this is treated as overcast. */
export const CLOUDY_MIN_PCT = 70;

export interface Thresholds {
  /** Lowest Kp with the edge within about 1000 km. Camera-on-the-horizon territory. */
  kpFaint: number | null;
  /** Lowest Kp with the edge within 5 degrees. The level the verdict treats as "enough". */
  kpVisible: number | null;
  /** Lowest Kp with the edge at or past this magnetic latitude. */
  kpOverhead: number | null;
}

export type Activity = 'overhead' | 'visible' | 'close' | 'faint' | 'quiet';
export type Sky = 'clear' | 'partly' | 'cloudy' | 'unknown';
export type Verdict = 'go' | 'maybe' | 'no';
export type Reason =
  | 'clear'
  | 'partly'
  | 'sky-unknown'
  | 'blocked'
  | 'borderline'
  | 'borderline-sky-unknown'
  | 'borderline-cloud'
  | 'faint'
  | 'quiet';

export interface Assessment {
  verdict: Verdict;
  reason: Reason;
  activity: Activity;
  sky: Sky;
}

/** Smallest whole Kp whose aurora edge lies within `marginDeg` of this magnetic latitude. */
export function kpNeeded(absMlat: number, marginDeg: number): number | null {
  for (let kp = 0; kp < KP_BOUNDARY.length; kp++) {
    if (KP_BOUNDARY[kp] <= absMlat + marginDeg) return kp;
  }
  return null;
}

export function thresholdsFor(absMlat: number): Thresholds {
  return {
    kpFaint: kpNeeded(absMlat, FAR_MARGIN_DEG),
    kpVisible: kpNeeded(absMlat, EASY_MARGIN_DEG),
    kpOverhead: kpNeeded(absMlat, 0),
  };
}

/**
 * NOAA reports Kp in thirds (4.67 is "5 minus") and counts 4.67 as Kp 5 for its G scale.
 * Rounding to the nearest whole number follows the same convention.
 */
export function kpLevel(kp: number): number {
  return Math.max(0, Math.min(9, Math.round(kp)));
}

export function activityFor(kp: number, t: Thresholds): Activity {
  const level = kpLevel(kp);
  if (t.kpOverhead !== null && level >= t.kpOverhead) return 'overhead';
  if (t.kpVisible !== null && level >= t.kpVisible) return 'visible';
  // One step short of "enough" counts as borderline. Where even Kp 9 is not enough, Kp 9 is borderline.
  if (level >= (t.kpVisible ?? 10) - 1) return 'close';
  if (t.kpFaint !== null && level >= t.kpFaint) return 'faint';
  return 'quiet';
}

export function skyFor(cloudPct: number | null | undefined): Sky {
  if (cloudPct === null || cloudPct === undefined || !Number.isFinite(cloudPct)) return 'unknown';
  if (cloudPct <= CLEAR_MAX_PCT) return 'clear';
  if (cloudPct <= CLOUDY_MIN_PCT) return 'partly';
  return 'cloudy';
}

/** Combine activity and sky for one dark hour. Darkness is handled by only assessing dark hours. */
export function assess(activity: Activity, sky: Sky): Assessment {
  const out = (verdict: Verdict, reason: Reason): Assessment => ({ verdict, reason, activity, sky });
  if (activity === 'overhead' || activity === 'visible') {
    if (sky === 'clear') return out('go', 'clear');
    if (sky === 'partly') return out('maybe', 'partly');
    if (sky === 'unknown') return out('maybe', 'sky-unknown');
    return out('no', 'blocked');
  }
  if (activity === 'close') {
    if (sky === 'clear') return out('maybe', 'borderline');
    if (sky === 'unknown') return out('maybe', 'borderline-sky-unknown');
    return out('no', 'borderline-cloud');
  }
  return out('no', activity === 'faint' ? 'faint' : 'quiet');
}

const VERDICT_RANK: Record<Verdict, number> = { go: 2, maybe: 1, no: 0 };
const ACTIVITY_RANK: Record<Activity, number> = { overhead: 4, visible: 3, close: 2, faint: 1, quiet: 0 };

export interface HourSlot {
  /** Start of the hour, ms since epoch. */
  start: number;
  kp: number | null;
  /** True when kp is the live estimate rather than a forecast. */
  live: boolean;
  cloud: number | null;
  assessment: Assessment | null;
}

/** Higher is better: verdict first, then activity, then clearer sky, then stronger Kp. */
export function slotScore(slot: HourSlot): number {
  if (!slot.assessment) return -1;
  const cloud = slot.cloud === null ? 50 : slot.cloud;
  return (
    VERDICT_RANK[slot.assessment.verdict] * 1e6 +
    ACTIVITY_RANK[slot.assessment.activity] * 1e4 +
    (100 - cloud) * 10 +
    (slot.kp ?? 0)
  );
}

export function bestSlot(slots: HourSlot[]): HourSlot | null {
  let best: HourSlot | null = null;
  for (const slot of slots) {
    if (!slot.assessment) continue;
    if (!best || slotScore(slot) > slotScore(best)) best = slot;
  }
  return best;
}

/** Consecutive hours that share the best verdict, as [start, end) ranges. */
export function windowsFor(slots: HourSlot[], verdict: Verdict): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const slot of slots) {
    if (slot.assessment?.verdict !== verdict) continue;
    const last = out[out.length - 1];
    if (last && last[1] === slot.start) last[1] = slot.start + 3600000;
    else out.push([slot.start, slot.start + 3600000]);
  }
  return out;
}

/** Bilinear lookup of magnetic latitude from the coarse grid shipped with the site. */
export interface MlatGrid {
  lat0: number;
  lon0: number;
  step: number;
  rows: number;
  cols: number;
  values: number[][];
}

export function mlatFromGrid(grid: MlatGrid, lat: number, lon: number): number | null {
  const lon360 = lon < 0 ? lon + 360 : lon;
  const y = (lat - grid.lat0) / grid.step;
  const x = (lon360 - grid.lon0) / grid.step;
  if (!(y >= 0 && x >= 0 && y <= grid.rows - 1 && x <= grid.cols - 1)) return null;
  const i = Math.min(Math.floor(y), grid.rows - 2);
  const j = Math.min(Math.floor(x), grid.cols - 2);
  const fy = y - i;
  const fx = x - j;
  const v = grid.values;
  const top = v[i][j] * (1 - fx) + v[i][j + 1] * fx;
  const bottom = v[i + 1][j] * (1 - fx) + v[i + 1][j + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Sixteen-point compass word for a true bearing. */
export function compassWord(bearing: number): string {
  const words = [
    'north', 'north-northeast', 'northeast', 'east-northeast',
    'east', 'east-southeast', 'southeast', 'south-southeast',
    'south', 'south-southwest', 'southwest', 'west-southwest',
    'west', 'west-northwest', 'northwest', 'north-northwest',
  ];
  return words[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

/** True bearing toward the nearest part of the auroral zone: the direction magnetic latitude rises fastest. */
export function bearingFromGrid(grid: MlatGrid, lat: number, lon: number): number | null {
  const d = 0.5;
  const n1 = mlatFromGrid(grid, lat + d, lon);
  const n0 = mlatFromGrid(grid, lat - d, lon);
  const e1 = mlatFromGrid(grid, lat, lon + d);
  const e0 = mlatFromGrid(grid, lat, lon - d);
  if (n1 === null || n0 === null || e1 === null || e0 === null) return null;
  const north = (Math.abs(n1) - Math.abs(n0)) / (2 * d);
  const east = (Math.abs(e1) - Math.abs(e0)) / (2 * d * Math.cos((lat * Math.PI) / 180));
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}
