import test from 'node:test';
import assert from 'node:assert/strict';
import { altitudeDeg, gmstDeg, hourlyRate, planNight, watchHours } from '../src/lib/meteors.ts';
import { watchCloud } from '../src/lib/geminids.ts';
import shower from '../src/data/geminids.json' with { type: 'json' };

const HOBART = { lat: -42.88, lon: 147.33 };
const BRISBANE = { lat: -27.47, lon: 153.03 };

test('sidereal time matches the published value at J2000', () => {
  // GMST at 2000-01-01 12:00 UT is 280.46 degrees.
  assert.ok(Math.abs(gmstDeg(Date.UTC(2000, 0, 1, 12)) - 280.46061837) < 1e-6);
});

test('the radiant can climb no higher than 90 minus the gap between latitude and declination', () => {
  for (const place of [HOBART, BRISBANE]) {
    const limit = 90 - Math.abs(place.lat - shower.radiant.decDeg);
    let highest = -90;
    const from = Date.UTC(2026, 11, 14, 0);
    for (let t = from; t < from + 86400000; t += 60000) {
      highest = Math.max(highest, altitudeDeg(t, place.lat, place.lon, shower.radiant.raDeg, shower.radiant.decDeg));
    }
    assert.ok(Math.abs(highest - limit) < 0.1, `${highest} vs ${limit}`);
  }
});

test('hourly rate: full ZHR overhead in a perfect sky, less when low or bright, none below the horizon', () => {
  assert.equal(Math.round(hourlyRate(150, 90, 2.6, 6.5)), 150);
  assert.equal(Math.round(hourlyRate(150, 30, 2.6, 6.5)), 75);
  assert.ok(Math.abs(hourlyRate(150, 90, 2.6, 5.5) - 150 / 2.6) < 1e-9);
  assert.equal(hourlyRate(150, -5, 2.6, 6.5), 0);
});

test('peak night plan for Hobart: dark, radiant rising after dusk, highest near dawn, moon setting', () => {
  const night = planNight('2026-12-14', HOBART.lat, HOBART.lon, shower);
  assert.equal(night.twilightOnly, false);
  assert.ok(night.darkEnd > night.darkStart);
  assert.ok(night.radiantRises !== null && night.radiantRises > night.darkStart && night.radiantRises < night.darkEnd);
  assert.equal(night.watchStart, night.radiantRises);
  assert.ok(night.bestAltDeg > 13 && night.bestAltDeg < 14.2);
  assert.ok(night.bestTime > night.radiantRises!);
  assert.ok(night.moonLit > 0.15 && night.moonLit < 0.35);
  assert.equal(night.moonWhileWatching, 'sets');
  assert.ok(night.moonSets! > night.watchStart! && night.moonSets! < night.watchEnd!);
  assert.ok(watchHours(night).length >= 3);
});

test('every evening and place on the page has a dark period with the radiant up', async () => {
  const { locations } = (await import('../src/data/locations.json', { with: { type: 'json' } })).default as { locations: Array<{ slug: string; lat: number; lon: number }> };
  for (const l of locations) {
    for (const evening of shower.evenings) {
      const night = planNight(evening, l.lat, l.lon, shower);
      assert.ok(night.watchStart !== null, `${l.slug} ${evening}`);
      assert.ok(night.bestAltDeg > 5, `${l.slug} ${evening}: radiant only ${night.bestAltDeg}`);
    }
  }
});

test('cloud over a watch is the average of its hours, and unknown where the forecast stops short', () => {
  const H = 3600000;
  const start = Date.UTC(2026, 11, 14, 13, 30);
  const end = start + 3 * H;
  const point = { lat: -42.88, lon: 147.33, ok: true, hours: [13, 14, 15, 16].map((h, i) => [Date.UTC(2026, 11, 14, h) / H, [10, 20, 30, 40][i], null, null, null]) };
  assert.equal(watchCloud(point, { start, end }), 25);
  // The forecast ends at 13:00 UT: the first hour is close enough to read, the last is not.
  assert.equal(watchCloud({ ...point, hours: point.hours.slice(0, 1) }, { start, end: start + 6 * H }), null);
  assert.equal(watchCloud(null, { start, end }), null);
});

test('shower data is internally consistent', () => {
  assert.ok(shower.evenings.every((e) => e >= shower.activity.from && e <= shower.activity.to));
  for (const peak of shower.peaks) assert.ok(!Number.isNaN(Date.parse(peak.time)));
});
