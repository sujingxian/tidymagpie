import test from 'node:test';
import assert from 'node:assert/strict';
import {
  darkIntervals, fullDarkHours, hourSlots, moonFor, nightsFrom, sunAltitudeDeg, FULL_DARK_DEG,
} from '../src/lib/sky.ts';

const HOBART = { lat: -42.88, lon: 147.33 };
const H = 3600000;

test('dark intervals really are dark, and their edges sit on the limit', () => {
  const from = Date.UTC(2026, 10, 17, 0);
  const spans = darkIntervals(from, from + 48 * H, HOBART.lat, HOBART.lon, FULL_DARK_DEG);
  assert.equal(spans.length, 2);
  for (const [start, end] of spans) {
    assert.ok(sunAltitudeDeg((start + end) / 2, HOBART.lat, HOBART.lon) < -18);
    assert.ok(Math.abs(sunAltitudeDeg(start, HOBART.lat, HOBART.lon) + 18) < 0.15);
    assert.ok(Math.abs(sunAltitudeDeg(end, HOBART.lat, HOBART.lon) + 18) < 0.15);
  }
});

test('Hobart in mid November: a short night around local midnight', () => {
  const now = Date.UTC(2026, 10, 16, 23, 53); // 10:53 am in Hobart on the 17th
  const nights = nightsFrom(now, HOBART.lat, HOBART.lon, 3);
  assert.equal(nights.length, 3);
  const [first] = nights;
  assert.equal(first.twilightOnly, false);
  const hours = (first.end - first.start) / H;
  assert.ok(hours > 4.5 && hours < 6.5, `night length ${hours}`);
  // Local midnight (13:00 UTC, as Hobart is on UTC+11) falls inside the night.
  assert.ok(first.start < Date.UTC(2026, 10, 17, 13) && first.end > Date.UTC(2026, 10, 17, 13));
  assert.ok(nights[1].start - first.start > 23 * H && nights[1].start - first.start < 25 * H);
});

test('night times do not depend on when you ask', () => {
  const asked = [Date.UTC(2026, 10, 16, 23, 53), Date.UTC(2026, 10, 17, 3, 7, 41), Date.UTC(2026, 10, 17, 13, 20), Date.UTC(2026, 10, 17, 15, 59, 59)];
  const seen = asked.map((now) => nightsFrom(now, HOBART.lat, HOBART.lon, 1)[0]);
  for (const night of seen) {
    assert.equal(night.start, seen[0].start);
    assert.equal(night.end, seen[0].end);
    assert.equal(night.start % 60000, 0);
  }
});

test('in the small hours the first night is the one in progress', () => {
  const now = Date.UTC(2026, 10, 17, 14); // 1 am in Hobart on the 18th
  const nights = nightsFrom(now, HOBART.lat, HOBART.lon, 2);
  assert.ok(nights[0].start < now && nights[0].end > now);
  const slots = hourSlots(nights[0], now);
  assert.equal(slots[0], now); // the hour that has just begun
  assert.ok(slots.every((t) => t % H === 0));
});

test('after dawn the first night is the coming one', () => {
  const now = Date.UTC(2026, 10, 17, 19); // 6 am in Hobart on the 18th
  const nights = nightsFrom(now, HOBART.lat, HOBART.lon, 1);
  assert.ok(nights[0].start > now);
});

test('far south in midsummer the sky never gets fully dark', () => {
  const now = Date.UTC(2026, 11, 21, 0);
  const nights = nightsFrom(now, -54.5, 158.94, 1); // Macquarie Island
  assert.equal(nights.length, 1);
  assert.equal(nights[0].twilightOnly, true);
  assert.equal(fullDarkHours(new Date(Date.UTC(2026, 11, 21)), -54.5, 158.94), 0);
});

test('seasonal darkness: long in June, short in December', () => {
  const june = fullDarkHours(new Date(Date.UTC(2026, 5, 21)), HOBART.lat, HOBART.lon);
  const december = fullDarkHours(new Date(Date.UTC(2026, 11, 21)), HOBART.lat, HOBART.lon);
  assert.ok(june > 11 && june < 12.5, `June ${june}`);
  assert.ok(december > 2.5 && december < 4.5, `December ${december}`);
});

test('moon summary stays within bounds', () => {
  const [night] = nightsFrom(Date.UTC(2026, 10, 16, 23, 53), HOBART.lat, HOBART.lon, 1);
  const moon = moonFor(night, HOBART.lat, HOBART.lon);
  assert.ok(moon.fraction >= 0 && moon.fraction <= 1);
  assert.ok(moon.upShare >= 0 && moon.upShare <= 1);
  if (moon.sets !== null) assert.ok(moon.sets > night.start && moon.sets <= night.end);
  // A known full moon (24 November 2026, about 14:53 UTC) is close to fully lit.
  const full = nightsFrom(Date.UTC(2026, 10, 24, 2), HOBART.lat, HOBART.lon, 1)[0];
  assert.ok(moonFor(full, HOBART.lat, HOBART.lon).fraction > 0.97);
});
