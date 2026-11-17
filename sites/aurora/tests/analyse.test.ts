import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyse, outlookFor, type Place, type Space } from '../src/lib/analyse.ts';
import type { CloudPoint } from '../src/lib/cloud.ts';
import { cloudAt } from '../src/lib/cloud.ts';
import { parseKpForecast } from '../src/lib/noaa.ts';

const data = JSON.parse(readFileSync(new URL('../src/data/locations.json', import.meta.url), 'utf8'));
const place = (slug: string): Place => data.locations.find((l: { slug: string }) => l.slug === slug);
const H = 3600000;

// The real NOAA forecast for the night of 17 November 2026 (UTC blocks).
const blocks = parseKpForecast([
  { kp: 3.33, noaa_scale: null, observed: 'predicted', time_tag: '2026-11-17T06:00:00' },
  { kp: 3.33, noaa_scale: null, observed: 'predicted', time_tag: '2026-11-17T09:00:00' },
  { kp: 3.67, noaa_scale: null, observed: 'predicted', time_tag: '2026-11-17T12:00:00' },
  { kp: 3.67, noaa_scale: null, observed: 'predicted', time_tag: '2026-11-17T15:00:00' },
  { kp: 3.67, noaa_scale: null, observed: 'predicted', time_tag: '2026-11-17T18:00:00' },
  { kp: 4.67, noaa_scale: 'G1', observed: 'predicted', time_tag: '2026-11-17T21:00:00' },
]);

const space = (over: Partial<Space> = {}): Space => ({
  fetched: 0, kpNow: null, blocks, wind: null, hemi: null, outlook: { issued: null, days: [] }, ...over,
});

function cloudy(lat: number, lon: number, from: number, hours: number, pct: (i: number) => number): CloudPoint {
  const rows = [];
  for (let i = 0; i < hours; i++) rows.push([Math.round(from / H) + i, pct(i), null, null, null]);
  return { lat, lon, ok: true, updated: null, hours: rows };
}

test('daytime in Hobart: tonight is judged from the forecast', () => {
  const hobart = place('hobart');
  const now = Date.UTC(2026, 10, 16, 23, 53);
  const clear = cloudy(hobart.lat, hobart.lon, now - H, 60, () => 10);
  const a = analyse(hobart, space({ kpNow: { kp: 0.33, time: now - 3 * 60000 } }), clear, now);
  assert.equal(a.darkNow, false);
  assert.equal(a.current, null);
  const tonight = a.nights[0];
  assert.ok(tonight.slots.length >= 5 && tonight.slots.length <= 7);
  assert.ok(tonight.slots.every((s) => s.source === 'forecast' && s.cloud === 10));
  assert.equal(tonight.peakKp, 3.67);
  assert.equal(tonight.verdict, 'go'); // Kp 3.67 counts as 4, which is Hobart's level, under a clear sky
  assert.equal(tonight.best?.assessment?.reason, 'clear');
  assert.ok(tonight.windows.length >= 1);
  // The same night under thick cloud is a no.
  const grey = cloudy(hobart.lat, hobart.lon, now - H, 60, () => 95);
  assert.equal(analyse(hobart, space(), grey, now).nights[0].verdict, 'no');
  assert.equal(analyse(hobart, space(), grey, now).nights[0].best?.assessment?.reason, 'blocked');
  // Without any cloud data the answer is hedged, not invented.
  const blind = analyse(hobart, space(), null, now).nights[0];
  assert.equal(blind.verdict, 'maybe');
  assert.equal(blind.best?.assessment?.reason, 'sky-unknown');
  assert.equal(blind.cloudMin, null);
});

test('the same forecast is not enough for Melbourne', () => {
  const now = Date.UTC(2026, 10, 16, 23, 53);
  const melbourne = place('melbourne');
  const a = analyse(melbourne, space(), cloudy(melbourne.lat, melbourne.lon, now - H, 60, () => 0), now);
  assert.equal(a.nights[0].verdict, 'no');
  assert.equal(a.nights[0].best?.assessment?.reason, 'quiet');
});

test('at night the live Kp decides the present hour', () => {
  const melbourne = place('melbourne');
  const now = Date.UTC(2026, 10, 17, 13, 20); // 12:20 am in Melbourne
  const sky = cloudy(melbourne.lat, melbourne.lon, now - 2 * H, 30, (i) => (i < 4 ? 20 : 90));
  const storm = analyse(melbourne, space({ kpNow: { kp: 6.67, time: now - 2 * 60000 } }), sky, now);
  assert.equal(storm.darkNow, true);
  assert.equal(storm.current?.source, 'live');
  assert.equal(storm.current?.kp, 6.67);
  assert.equal(storm.current?.assessment?.verdict, 'go');
  // Later hours fall back to the forecast, which is too low for Melbourne, and to thicker cloud.
  const later = storm.nights[0].slots.filter((s) => s.start > now);
  assert.ok(later.length > 0 && later.every((s) => s.source === 'forecast' && s.assessment?.verdict === 'no'));
  // A live value that is 50 minutes old is not treated as live.
  const old = analyse(melbourne, space({ kpNow: { kp: 6.67, time: now - 50 * 60000 } }), sky, now);
  assert.equal(old.current?.source, 'forecast');
  assert.equal(old.current?.assessment?.verdict, 'no');
});

test('beyond the three-hourly forecast the daily outlook fills in', () => {
  const hobart = place('hobart');
  const now = Date.UTC(2026, 10, 16, 23, 53);
  const outlook = { issued: null, days: [{ date: '2026-11-18', kp: 5 }, { date: '2026-11-19', kp: 2 }] };
  const a = analyse(hobart, space({ outlook }), null, now);
  assert.equal(a.nights[1].kpSource, 'outlook');
  assert.equal(a.nights[1].peakKp, 5);
  assert.equal(a.nights[1].verdict, 'maybe'); // strong enough, sky unknown
  assert.equal(a.nights[2].peakKp, 2);
  assert.equal(a.nights[2].verdict, 'no');
  // With no outlook either, the night has no verdict at all.
  assert.equal(analyse(hobart, space(), null, now).nights[2].verdict, null);
});

test('cloud lookup takes the nearest hour and gives up past the end', () => {
  const point = cloudy(-42.88, 147.33, Date.UTC(2026, 10, 17, 0), 3, (i) => i * 10);
  assert.equal(cloudAt(point, Date.UTC(2026, 10, 17, 1, 20))?.total, 10);
  assert.equal(cloudAt(point, Date.UTC(2026, 10, 17, 1, 40))?.total, 20);
  assert.equal(cloudAt(point, Date.UTC(2026, 10, 17, 9)), null);
  assert.equal(cloudAt(null, 0), null);
  assert.equal(cloudAt({ lat: 0, lon: 0, ok: false }, 0), null);
});

test('27-day outlook read for a place', () => {
  const rows = outlookFor(place('hobart'), { issued: null, days: [{ date: '2026-11-16', kp: 4 }, { date: '2026-11-17', kp: 5 }, { date: '2026-11-18', kp: 2 }] }, '2026-11-17');
  assert.deepEqual(rows.map((r) => [r.date, r.activity]), [['2026-11-17', 'visible'], ['2026-11-18', 'quiet']]);
});
