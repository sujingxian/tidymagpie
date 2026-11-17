// Turns the raw inputs (place, space weather, cloud forecast, clock) into what the page shows.
// Pure: same inputs, same answer. The DOM code in app.ts only formats the result.
import {
  activityFor,
  assess,
  bestSlot,
  kpLevel,
  skyFor,
  windowsFor,
  type Assessment,
  type HourSlot,
  type Thresholds,
  type Verdict,
} from './model.ts';
import { cloudAt, type CloudPoint } from './cloud.ts';
import { kpForTime, type HemiPower, type KpBlock, type KpNow, type Outlook27, type SolarWind } from './noaa.ts';
import { hourSlots, moonFor, nightsFrom, type MoonSummary, type Night } from './sky.ts';

export interface Place extends Thresholds {
  name: string;
  lat: number;
  lon: number;
  /** IANA zone for showing times. Left out for a visitor's own coordinates. */
  tz?: string;
  mlat: number;
  bearing?: number | null;
  slug?: string;
}

export interface Space {
  /** When the page last asked NOAA, ms since epoch. */
  fetched: number;
  kpNow: KpNow | null;
  blocks: KpBlock[];
  wind: SolarWind | null;
  hemi: HemiPower | null;
  outlook: Outlook27;
}

export type KpSource = 'live' | 'forecast' | 'outlook';

export interface Slot extends HourSlot {
  source: KpSource | null;
}

export interface NightView {
  night: Night;
  slots: Slot[];
  best: Slot | null;
  verdict: Verdict | null;
  /** Hours sharing the best verdict, as [start, end) ranges. */
  windows: Array<[number, number]>;
  peakKp: number | null;
  peakKpAt: number | null;
  /** Where most of the night's Kp values came from. */
  kpSource: KpSource | null;
  cloudMin: number | null;
  cloudMax: number | null;
  moon: MoonSummary;
}

export interface Analysis {
  now: number;
  /** True when it is dark at the place right now. */
  darkNow: boolean;
  /** The present hour, assessed with the live Kp. Only set when it is dark. */
  current: Slot | null;
  nights: NightView[];
}

/** A live Kp older than this is not treated as "now". */
export const LIVE_KP_MAX_AGE_MS = 45 * 60 * 1000;

const HOUR = 3600000;

function outlookKp(outlook: Outlook27, ms: number): number | null {
  const date = new Date(ms).toISOString().slice(0, 10);
  const day = outlook.days.find((d) => d.date === date);
  return day ? day.kp : null;
}

function buildSlot(start: number, place: Place, space: Space, cloud: CloudPoint | null, now: number): Slot {
  const isCurrent = now >= start && now < start + HOUR;
  let kp: number | null = null;
  let source: KpSource | null = null;
  if (isCurrent && space.kpNow && now - space.kpNow.time < LIVE_KP_MAX_AGE_MS) {
    kp = space.kpNow.kp;
    source = 'live';
  } else {
    const block = kpForTime(space.blocks, start);
    if (block) {
      kp = block.kp;
      source = 'forecast';
    } else {
      kp = outlookKp(space.outlook, start);
      source = kp === null ? null : 'outlook';
    }
  }
  const reading = cloudAt(cloud, isCurrent ? now : start + HOUR / 2);
  const cloudPct = reading ? reading.total : null;
  const assessment: Assessment | null = kp === null ? null : assess(activityFor(kp, place), skyFor(cloudPct));
  return { start, kp, live: source === 'live', source, cloud: cloudPct, assessment };
}

function viewNight(night: Night, place: Place, space: Space, cloud: CloudPoint | null, now: number): NightView {
  const slots = hourSlots(night, now).map((start) => buildSlot(start, place, space, cloud, now));
  const best = bestSlot(slots) as Slot | null;
  const verdict = best?.assessment?.verdict ?? null;
  let peakKp: number | null = null;
  let peakKpAt: number | null = null;
  const sources: Record<string, number> = {};
  const clouds: number[] = [];
  for (const slot of slots) {
    if (slot.kp !== null && (peakKp === null || slot.kp > peakKp)) {
      peakKp = slot.kp;
      peakKpAt = slot.start;
    }
    if (slot.source) sources[slot.source] = (sources[slot.source] ?? 0) + 1;
    if (slot.cloud !== null) clouds.push(slot.cloud);
  }
  const kpSource = (Object.entries(sources).sort((a, b) => b[1] - a[1])[0]?.[0] as KpSource | undefined) ?? null;
  return {
    night,
    slots,
    best,
    verdict,
    windows: verdict ? windowsFor(slots, verdict) : [],
    peakKp,
    peakKpAt,
    kpSource,
    cloudMin: clouds.length ? Math.min(...clouds) : null,
    cloudMax: clouds.length ? Math.max(...clouds) : null,
    moon: moonFor(night, place.lat, place.lon),
  };
}

export function analyse(place: Place, space: Space, cloud: CloudPoint | null, now: number, nightCount = 3): Analysis {
  const nights = nightsFrom(now, place.lat, place.lon, nightCount);
  const darkNow = nights.length > 0 && now >= nights[0].start && now < nights[0].end;
  return {
    now,
    darkNow,
    current: darkNow ? buildSlot(Math.floor(now / HOUR) * HOUR, place, space, cloud, now) : null,
    nights: nights.map((night) => viewNight(night, place, space, cloud, now)),
  };
}

/** What a Kp value means for a place over a whole day, used for the 27-day outlook. */
export function outlookFor(place: Thresholds, outlook: Outlook27, fromDate: string) {
  return outlook.days
    .filter((day) => day.date >= fromDate)
    .map((day) => ({ ...day, level: kpLevel(day.kp), activity: activityFor(day.kp, place) }));
}
