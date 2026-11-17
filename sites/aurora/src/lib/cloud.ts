// Cloud cover, fetched from this site's own /api/cloud (a caching proxy for MET Norway).

export interface CloudPoint {
  lat: number;
  lon: number;
  ok: boolean;
  updated?: string | null;
  stale?: boolean;
  /** Rows of [hours since epoch, total %, low %, medium %, high %]. */
  hours?: Array<Array<number | null>>;
  error?: string;
}

export interface CloudReading {
  total: number;
  low: number | null;
  mid: number | null;
  high: number | null;
}

const MAX_GAP_MS = 3.5 * 3600000; // the forecast turns six-hourly after about two and a half days
const KEEP_MS = 20 * 60 * 1000;
const BATCH = 16;
const TIMEOUT_MS = 15000;
const STORE_PREFIX = 'tm-aurora-cloud-v1:';

export function pointKey(lat: number, lon: number): string {
  return `${(Math.round(lat * 100) / 100).toFixed(2)},${(Math.round(lon * 100) / 100).toFixed(2)}`;
}

/** Cloud cover nearest to a moment, or null when the forecast does not reach it. */
export function cloudAt(point: CloudPoint | null | undefined, ms: number): CloudReading | null {
  if (!point || !point.ok || !point.hours) return null;
  let best: Array<number | null> | null = null;
  let bestGap = Infinity;
  for (const row of point.hours) {
    const t = (row[0] as number) * 3600000;
    const gap = Math.abs(t - ms);
    if (gap < bestGap) {
      bestGap = gap;
      best = row;
    }
  }
  if (!best || bestGap > MAX_GAP_MS || typeof best[1] !== 'number') return null;
  return { total: best[1], low: best[2] ?? null, mid: best[3] ?? null, high: best[4] ?? null };
}

function recall(key: string): CloudPoint | null {
  try {
    const raw = sessionStorage.getItem(STORE_PREFIX + key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { t: number; p: CloudPoint };
    return Date.now() - saved.t < KEEP_MS ? saved.p : null;
  } catch {
    return null;
  }
}

function remember(key: string, point: CloudPoint): void {
  try {
    sessionStorage.setItem(STORE_PREFIX + key, JSON.stringify({ t: Date.now(), p: point }));
  } catch {
    // Private mode or a full store: the page simply asks again next time.
  }
}

/** Cloud forecasts for a list of places. Missing entries mean the forecast could not be loaded. */
export async function fetchCloud(places: Array<{ lat: number; lon: number }>): Promise<Record<string, CloudPoint>> {
  const out: Record<string, CloudPoint> = {};
  const wanted: string[] = [];
  for (const place of places) {
    const key = pointKey(place.lat, place.lon);
    if (key in out || wanted.includes(key)) continue;
    const saved = recall(key);
    if (saved) out[key] = saved;
    else wanted.push(key);
  }
  for (let i = 0; i < wanted.length; i += BATCH) {
    const chunk = wanted.slice(i, i + BATCH);
    try {
      const query = chunk.map((key) => `p=${encodeURIComponent(key)}`).join('&');
      const control = new AbortController();
      const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
      const response = await fetch(`/api/cloud?${query}`, { signal: control.signal }).finally(() => clearTimeout(timer));
      if (!response.ok) continue;
      const body = (await response.json()) as { points?: CloudPoint[] };
      for (const point of body.points ?? []) {
        if (!point || !point.ok) continue;
        const key = pointKey(point.lat, point.lon);
        out[key] = point;
        if (!point.stale) remember(key, point);
      }
    } catch {
      // Leave these places without cloud data; the verdict says so.
    }
  }
  return out;
}
