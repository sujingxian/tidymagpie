// Darkness and moon, computed in the browser with SunCalc. No network involved.
import SunCalc from 'suncalc';

const DEG = 180 / Math.PI;
const STEP_MS = 5 * 60 * 1000;

/** Sun below this many degrees: astronomical night, the sky is fully dark. */
export const FULL_DARK_DEG = -18;
/** Sun below this many degrees: nautical night, dark enough only for strong displays. */
export const TWILIGHT_DARK_DEG = -12;

export function sunAltitudeDeg(ms: number, lat: number, lon: number): number {
  return SunCalc.getPosition(new Date(ms), lat, lon).altitude * DEG;
}

function crossing(a: number, b: number, lat: number, lon: number, limitDeg: number): number {
  // a and b straddle the limit. Narrow it to a second, then give the nearest whole minute, so the
  // time shown does not depend on the moment the page happened to be opened.
  const below = sunAltitudeDeg(a, lat, lon) < limitDeg;
  let lo = a;
  let hi = b;
  while (hi - lo > 1000) {
    const mid = (lo + hi) / 2;
    if (sunAltitudeDeg(mid, lat, lon) < limitDeg === below) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2 / 60000) * 60000;
}

/** Periods between `from` and `to` when the sun is below `limitDeg`, as [start, end] in ms. */
export function darkIntervals(from: number, to: number, lat: number, lon: number, limitDeg: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let prevT = from;
  let prevDark = sunAltitudeDeg(from, lat, lon) < limitDeg;
  let start: number | null = prevDark ? from : null;
  for (let t = from + STEP_MS; t <= to; t += STEP_MS) {
    const dark = sunAltitudeDeg(t, lat, lon) < limitDeg;
    if (dark !== prevDark) {
      const edge = crossing(prevT, t, lat, lon, limitDeg);
      if (dark) start = edge;
      else if (start !== null) {
        out.push([start, edge]);
        start = null;
      }
    }
    prevT = t;
    prevDark = dark;
  }
  if (start !== null) out.push([start, to]);
  return out;
}

export interface Night {
  /** Start and end of the usable dark period, ms since epoch. */
  start: number;
  end: number;
  /** True when the sun never gets 18 degrees down, so this is nautical twilight only. */
  twilightOnly: boolean;
}

/**
 * The current or next night and the ones after it. A night that has already ended is skipped,
 * so in the small hours the first entry is the night in progress.
 */
export function nightsFrom(now: number, lat: number, lon: number, count: number): Night[] {
  const from = now - 20 * 3600000;
  const to = now + (count + 1) * 24 * 3600000;
  const nautical = darkIntervals(from, to, lat, lon, TWILIGHT_DARK_DEG);
  const full = darkIntervals(from, to, lat, lon, FULL_DARK_DEG);
  const nights: Night[] = [];
  for (const [nStart, nEnd] of nautical) {
    // A window cut off by the scan edge is not a whole night.
    if (nStart === from || nEnd === to) continue;
    const inner = full.find(([s, e]) => s >= nStart && e <= nEnd);
    const night: Night = inner
      ? { start: inner[0], end: inner[1], twilightOnly: false }
      : { start: nStart, end: nEnd, twilightOnly: true };
    if (night.end > now) nights.push(night);
  }
  return nights.slice(0, count);
}

/** Whole clock hours (UTC-aligned) that overlap the night by at least half an hour. */
export function hourSlots(night: Night, notBefore = -Infinity): number[] {
  const out: number[] = [];
  const first = Math.floor(night.start / 3600000) * 3600000;
  for (let t = first; t < night.end; t += 3600000) {
    const overlap = Math.min(t + 3600000, night.end) - Math.max(t, night.start);
    if (overlap >= 1800000 && t + 3600000 > notBefore) out.push(t);
  }
  return out;
}

export interface MoonSummary {
  /** Illuminated fraction, 0 to 1, at the middle of the night. */
  fraction: number;
  /** Share of the dark period with the moon above the horizon, 0 to 1. */
  upShare: number;
  /** When the moon rises or sets inside the dark period, if it does. */
  rises: number | null;
  sets: number | null;
}

export function moonAltitudeDeg(ms: number, lat: number, lon: number): number {
  return SunCalc.getMoonPosition(new Date(ms), lat, lon).altitude * DEG;
}

export function moonFraction(ms: number): number {
  return SunCalc.getMoonIllumination(new Date(ms)).fraction;
}

export function moonFor(night: Night, lat: number, lon: number): MoonSummary {
  const step = 10 * 60 * 1000;
  let up = 0;
  let total = 0;
  let rises: number | null = null;
  let sets: number | null = null;
  let prev: boolean | null = null;
  for (let t = night.start; t <= night.end; t += step) {
    const isUp = moonAltitudeDeg(t, lat, lon) > 0;
    if (prev !== null && isUp !== prev) {
      if (isUp && rises === null) rises = t;
      if (!isUp && sets === null) sets = t;
    }
    if (isUp) up++;
    total++;
    prev = isUp;
  }
  return {
    fraction: moonFraction((night.start + night.end) / 2),
    upShare: total ? up / total : 0,
    rises,
    sets,
  };
}

/** Hours of full darkness on a given UTC date at a location. Used for the seasonal table. */
export function fullDarkHours(dateUtc: Date, lat: number, lon: number): number {
  // Start the scan at local solar noon so the whole night falls inside one 24 hour window.
  const noon = Date.UTC(dateUtc.getUTCFullYear(), dateUtc.getUTCMonth(), dateUtc.getUTCDate(), 12) - (lon / 15) * 3600000;
  const spans = darkIntervals(noon, noon + 24 * 3600000, lat, lon, FULL_DARK_DEG);
  return spans.reduce((sum, [s, e]) => sum + (e - s), 0) / 3600000;
}
