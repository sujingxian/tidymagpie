// Caching proxy in front of MET Norway's Locationforecast API (used by functions/api/cloud.js).
//
// Why a proxy: MET Norway asks that browsers do not call the API directly, that every client
// identifies itself, that nothing is re-requested before its Expires time, and that unchanged
// data is revalidated with If-Modified-Since. This does all four, and it means MET Norway never
// sees a visitor's IP address. Terms: https://docs.api.met.no/doc/TermsOfService

export const UPSTREAM_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
export const USER_AGENT = 'TidyMagpieAurora/1.0 https://aurora.tidymagpie.com/about/';
export const MAX_POINTS = 16;

const KEEP_HOURS = 96; // how far ahead to pass on
const STORE_SECONDS = 6 * 3600; // keep a copy this long so it can be revalidated or served stale
const MIN_FRESH_MS = 10 * 60 * 1000;
const MAX_FRESH_MS = 3 * 3600 * 1000;
const DEFAULT_FRESH_MS = 30 * 60 * 1000;
const BRAKE_WINDOW_MS = 10 * 1000;
const BRAKE_MAX_CALLS = 30; // upstream calls per window, per running instance
const BACKOFF_MS = 5 * 60 * 1000; // pause after the upstream says we are throttled or blocked

// Coverage: Australia, New Zealand and the nearby Southern Ocean islands.
export function inBounds(lat, lon) {
  return lat >= -56 && lat <= -8 && ((lon >= 110 && lon <= 180) || (lon >= -180 && lon <= -170));
}

export class BadRequest extends Error {}

export function parsePoints(url) {
  const raw = url.searchParams.getAll('p');
  if (raw.length === 0) throw new BadRequest('Add at least one point: ?p=lat,lon');
  if (raw.length > MAX_POINTS) throw new BadRequest(`At most ${MAX_POINTS} points per request`);
  const seen = new Set();
  const points = [];
  for (const item of raw) {
    const m = /^(-?\d{1,2}(?:\.\d{1,4})?),(-?\d{1,3}(?:\.\d{1,4})?)$/.exec(item);
    if (!m) throw new BadRequest('Points look like -42.88,147.33');
    const lat = Math.round(Number(m[1]) * 100) / 100;
    const lon = Math.round(Number(m[2]) * 100) / 100;
    if (!inBounds(lat, lon)) throw new BadRequest('Only Australia and New Zealand are covered');
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ lat, lon, key });
  }
  return points;
}

const pct = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null);

/** Reduce the upstream forecast to [hours since epoch, total, low, medium, high cloud %]. */
export function compact(json, nowMs) {
  const series = json && json.properties && json.properties.timeseries;
  if (!Array.isArray(series)) return null;
  const hours = [];
  for (const entry of series) {
    const t = Date.parse(entry && entry.time);
    const d = entry && entry.data && entry.data.instant && entry.data.instant.details;
    if (!Number.isFinite(t) || !d) continue;
    if (t < nowMs - 2 * 3600000 || t > nowMs + KEEP_HOURS * 3600000) continue;
    const total = pct(d.cloud_area_fraction);
    if (total === null) continue;
    hours.push([
      Math.round(t / 3600000),
      total,
      pct(d.cloud_area_fraction_low),
      pct(d.cloud_area_fraction_medium),
      pct(d.cloud_area_fraction_high),
    ]);
  }
  if (!hours.length) return null;
  const meta = json.properties.meta;
  return { updated: (meta && meta.updated_at) || null, hours };
}

function freshUntil(response, now) {
  const expires = Date.parse(response.headers.get('expires') || '');
  const wanted = Number.isFinite(expires) ? expires : now + DEFAULT_FRESH_MS;
  return Math.min(Math.max(wanted, now + MIN_FRESH_MS), now + MAX_FRESH_MS);
}

// Per-instance guards. They do not survive a restart, which is fine: they are a brake, not a ledger.
const guard = { calls: [], pausedUntil: 0 };

function mayCallUpstream(now) {
  if (now < guard.pausedUntil) return false;
  guard.calls = guard.calls.filter((t) => now - t < BRAKE_WINDOW_MS);
  if (guard.calls.length >= BRAKE_MAX_CALLS) return false;
  guard.calls.push(now);
  return true;
}

export function resetGuards() {
  guard.calls = [];
  guard.pausedUntil = 0;
}

const cacheKey = (point) => new Request(`https://cloud-cache.invalid/v1/${point.key}`);

function store(deps, point, record) {
  const body = new Response(JSON.stringify(record), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${STORE_SECONDS}` },
  });
  deps.defer(Promise.resolve(deps.cache.put(cacheKey(point), body)).catch(() => {}));
}

const publish = (point, record, how) => ({
  lat: point.lat,
  lon: point.lon,
  ok: true,
  updated: record.updated,
  stale: how === 'stale',
  hours: record.hours,
  cache: how,
});

const failure = (point, error) => ({ lat: point.lat, lon: point.lon, ok: false, error, cache: 'none' });

export async function loadPoint(point, deps) {
  const now = deps.now();
  let stored = null;
  try {
    const hit = await deps.cache.match(cacheKey(point));
    if (hit) stored = await hit.json();
  } catch {
    stored = null;
  }
  if (stored && now < stored.fresh) return publish(point, stored, 'hit');

  const usable = stored && now - stored.fetched < STORE_SECONDS * 1000;
  if (!mayCallUpstream(now)) return usable ? publish(point, stored, 'stale') : failure(point, 'busy');

  let response = null;
  try {
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
    if (stored && stored.lastModified) headers['If-Modified-Since'] = stored.lastModified;
    response = await deps.fetch(`${deps.upstream}?lat=${point.lat.toFixed(2)}&lon=${point.lon.toFixed(2)}`, { headers });
  } catch {
    response = null;
  }

  if (response && response.status === 304 && stored) {
    const record = { ...stored, fresh: freshUntil(response, now) };
    store(deps, point, record);
    return publish(point, record, 'revalidated');
  }
  if (response && (response.status === 200 || response.status === 203)) {
    let reduced = null;
    try {
      reduced = compact(await response.json(), now);
    } catch {
      reduced = null;
    }
    if (reduced) {
      const record = {
        updated: reduced.updated,
        hours: reduced.hours,
        fetched: now,
        fresh: freshUntil(response, now),
        lastModified: response.headers.get('last-modified'),
      };
      store(deps, point, record);
      return publish(point, record, 'miss');
    }
  }
  if (response && (response.status === 429 || response.status === 403)) guard.pausedUntil = now + BACKOFF_MS;
  if (usable) return publish(point, stored, 'stale');
  return failure(point, response ? `upstream ${response.status}` : 'upstream unreachable');
}

const json = (body, status, cacheControl, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl, ...extra },
  });

export async function handleCloud(request, deps) {
  let points;
  try {
    points = parsePoints(new URL(request.url));
  } catch (error) {
    if (error instanceof BadRequest) return json({ v: 1, error: error.message }, 400, 'no-store');
    throw error;
  }
  const results = await Promise.all(points.map((point) => loadPoint(point, deps)));
  const allGood = results.every((r) => r.ok && !r.stale);
  const trail = results.map((r) => r.cache).join(',');
  return json(
    {
      v: 1,
      attribution: 'Cloud forecast: MET Norway (api.met.no), CC BY 4.0',
      points: results.map(({ cache, ...rest }) => rest),
    },
    200,
    allGood ? 'public, max-age=300' : 'public, max-age=30',
    { 'X-Cloud-Cache': trail },
  );
}
