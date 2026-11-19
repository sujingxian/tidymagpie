// Meteor shower planning for one place: when it is dark, where the radiant is, and how many
// meteors the best hour could bring. Pure functions, so the page can work it all out when it is
// built and the tests can check it.
import { darkIntervals, FULL_DARK_DEG, moonAltitudeDeg, moonFraction, TWILIGHT_DARK_DEG } from './sky.ts';

const RAD = Math.PI / 180;
const STEP_MS = 5 * 60 * 1000;
const HOUR = 3600000;

/** Greenwich mean sidereal time in degrees. Accurate to well under a minute of time this century. */
export function gmstDeg(ms: number): number {
  const days = ms / 86400000 + 2440587.5 - 2451545.0;
  return (((280.46061837 + 360.98564736629 * days) % 360) + 360) % 360;
}

/** Height of a point on the sky above the horizon, in degrees, ignoring refraction. */
export function altitudeDeg(ms: number, lat: number, lon: number, raDeg: number, decDeg: number): number {
  const hourAngle = (gmstDeg(ms) + lon - raDeg) * RAD;
  const phi = lat * RAD;
  const dec = decDeg * RAD;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle)) / RAD;
}

/**
 * Meteors one person can expect to count in an hour. The inverse of the zenithal hourly rate:
 * ZHR × sin(radiant height) ÷ r^(6.5 − limiting magnitude). Zero while the radiant is below the horizon.
 */
export function hourlyRate(zhr: number, radiantAltDeg: number, populationIndex: number, limitingMagnitude: number): number {
  if (radiantAltDeg <= 0) return 0;
  return (zhr * Math.sin(radiantAltDeg * RAD)) / populationIndex ** (6.5 - limitingMagnitude);
}

export interface Shower {
  zhr: number;
  radiant: { raDeg: number; decDeg: number };
  populationIndex: number;
}

export interface ShowerNight {
  /** The calendar date the evening falls on, YYYY-MM-DD. */
  evening: string;
  /** Darkness used for counting: astronomical night, or nautical night where the sun never gets 18 degrees down. */
  darkStart: number;
  darkEnd: number;
  twilightOnly: boolean;
  /** When the radiant clears the horizon, or null if it is already up when darkness falls. */
  radiantRises: number | null;
  /** The part of the dark period with the radiant above the horizon. Null if it never is. */
  watchStart: number | null;
  watchEnd: number | null;
  /** Highest point the radiant reaches while it is dark. */
  bestTime: number;
  bestAltDeg: number;
  /** Moon: share lit at the middle of the dark period, and when it sets while the radiant is up. */
  moonLit: number;
  /** 'down': not up while the radiant is. 'sets': up at first, gone by moonSets. 'up': up throughout. */
  moonWhileWatching: 'down' | 'sets' | 'up';
  moonSets: number | null;
}

/** Local solar noon on a date at a longitude, so the whole night falls inside the following 24 hours. */
function solarNoon(evening: string, lon: number): number {
  const [y, m, d] = evening.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12) - (lon / 15) * HOUR;
}

export function planNight(evening: string, lat: number, lon: number, shower: Shower): ShowerNight {
  const noon = solarNoon(evening, lon);
  const to = noon + 24 * HOUR;
  let spans = darkIntervals(noon, to, lat, lon, FULL_DARK_DEG);
  let twilightOnly = false;
  if (spans.length === 0) {
    spans = darkIntervals(noon, to, lat, lon, TWILIGHT_DARK_DEG);
    twilightOnly = true;
  }
  if (spans.length === 0) throw new Error(`No dark period at ${lat},${lon} on ${evening}`);
  const [darkStart, darkEnd] = spans.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));

  const { raDeg, decDeg } = shower.radiant;
  let bestTime = darkStart;
  let bestAltDeg = -90;
  let watchStart: number | null = null;
  let watchEnd: number | null = null;
  let radiantRises: number | null = null;
  let moonUpAny = false;
  let moonUpLast = false;
  let moonSets: number | null = null;
  let prevUp: boolean | null = null;
  for (let t = darkStart; t <= darkEnd; t += STEP_MS) {
    const alt = altitudeDeg(t, lat, lon, raDeg, decDeg);
    const up = alt > 0;
    if (alt > bestAltDeg) {
      bestAltDeg = alt;
      bestTime = t;
    }
    if (up) {
      if (watchStart === null) watchStart = t;
      watchEnd = Math.min(t + STEP_MS, darkEnd);
      const moonUp = moonAltitudeDeg(t, lat, lon) > 0;
      if (moonUpLast && !moonUp && moonSets === null) moonSets = t;
      if (moonUp) moonUpAny = true;
      moonUpLast = moonUp;
    }
    if (prevUp === false && up && radiantRises === null) radiantRises = t;
    prevUp = up;
  }
  return {
    evening,
    darkStart,
    darkEnd,
    twilightOnly,
    radiantRises,
    watchStart,
    watchEnd,
    bestTime,
    bestAltDeg,
    moonLit: moonFraction((darkStart + darkEnd) / 2),
    moonWhileWatching: !moonUpAny ? 'down' : moonSets !== null ? 'sets' : 'up',
    moonSets,
  };
}

/** Hours that overlap the watch window, as hour starts, for reading the cloud forecast. */
export function watchHours(night: ShowerNight): number[] {
  if (night.watchStart === null || night.watchEnd === null) return [];
  const out: number[] = [];
  for (let t = Math.floor(night.watchStart / HOUR) * HOUR; t < night.watchEnd; t += HOUR) out.push(t);
  return out;
}
