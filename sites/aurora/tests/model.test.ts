import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  activityFor, assess, bearingFromGrid, bestSlot, compassWord, kpLevel, kpNeeded, mlatFromGrid, skyFor,
  thresholdsFor, windowsFor, type HourSlot,
} from '../src/lib/model.ts';

const data = JSON.parse(readFileSync(new URL('../src/data/locations.json', import.meta.url), 'utf8'));
const grid = JSON.parse(readFileSync(new URL('../src/data/mlat-grid.json', import.meta.url), 'utf8'));
const place = (slug: string) => data.locations.find((l: { slug: string }) => l.slug === slug);

test('kp thresholds follow the NOAA edge table', () => {
  assert.equal(kpNeeded(66.5, 0), 0);
  assert.equal(kpNeeded(53.4, 5), 4); // Hobart: edge at 58.3 for Kp 4 is within 5 degrees of 53.4
  assert.equal(kpNeeded(53.4, 0), 7);
  assert.equal(kpNeeded(48.1, 5), 7);
  assert.equal(kpNeeded(36.2, 9), null); // Brisbane: out of reach of the table
});

test('stored thresholds match the rule', () => {
  for (const l of data.locations) {
    // The stored magnetic latitude is rounded to 0.1, so allow a one-step difference only at a boundary.
    const t = thresholdsFor(Math.abs(l.mlat));
    for (const k of ['kpFaint', 'kpVisible', 'kpOverhead'] as const) {
      const a = l[k] ?? 10;
      const b = t[k] ?? 10;
      assert.ok(Math.abs(a - b) <= 1, `${l.slug} ${k}: stored ${l[k]}, rule ${t[k]}`);
    }
  }
});

test('grid interpolation reproduces the stored magnetic latitudes', () => {
  for (const l of data.locations) {
    const m = mlatFromGrid(grid, l.lat, l.lon);
    assert.ok(m !== null && Math.abs(m - l.mlat) < 0.06, `${l.slug}: grid ${m}, stored ${l.mlat}`);
    const b = bearingFromGrid(grid, l.lat, l.lon);
    assert.ok(b !== null && Math.abs(b - l.bearing) <= 2, `${l.slug}: bearing ${b}, stored ${l.bearing}`);
  }
  assert.equal(mlatFromGrid(grid, 10, 150), null); // north of the grid
  assert.equal(mlatFromGrid(grid, -40, 100), null); // west of the grid
  assert.ok(mlatFromGrid(grid, -43.95, -176.55) !== null); // Chatham Islands, east of the date line
});

test('kp rounds the way NOAA counts thirds', () => {
  assert.equal(kpLevel(4.67), 5);
  assert.equal(kpLevel(4.33), 4);
  assert.equal(kpLevel(0), 0);
  assert.equal(kpLevel(9), 9);
});

test('activity levels for Hobart and Brisbane', () => {
  const hobart = place('hobart');
  assert.equal(activityFor(1, hobart), 'quiet');
  assert.equal(activityFor(3, hobart), 'close');
  assert.equal(activityFor(3.67, hobart), 'visible');
  assert.equal(activityFor(7, hobart), 'overhead');
  const melbourne = place('melbourne');
  assert.equal(activityFor(5, melbourne), 'faint');
  assert.equal(activityFor(6, melbourne), 'close');
  assert.equal(activityFor(7, melbourne), 'visible');
  const brisbane = place('brisbane');
  assert.equal(activityFor(8, brisbane), 'quiet');
  assert.equal(activityFor(9, brisbane), 'close');
});

test('sky classes', () => {
  assert.equal(skyFor(null), 'unknown');
  assert.equal(skyFor(0), 'clear');
  assert.equal(skyFor(30), 'clear');
  assert.equal(skyFor(31), 'partly');
  assert.equal(skyFor(70), 'partly');
  assert.equal(skyFor(71), 'cloudy');
});

test('verdict table', () => {
  assert.deepEqual([assess('visible', 'clear').verdict, assess('visible', 'clear').reason], ['go', 'clear']);
  assert.equal(assess('overhead', 'partly').verdict, 'maybe');
  assert.equal(assess('visible', 'unknown').verdict, 'maybe');
  assert.equal(assess('visible', 'cloudy').verdict, 'no');
  assert.equal(assess('close', 'clear').verdict, 'maybe');
  assert.equal(assess('close', 'partly').verdict, 'no');
  assert.equal(assess('faint', 'clear').verdict, 'no');
  assert.equal(assess('quiet', 'clear').reason, 'quiet');
});

test('best slot and windows', () => {
  const h = 3600000;
  const slot = (i: number, kp: number, cloud: number, t: { kpFaint: number; kpVisible: number; kpOverhead: number }): HourSlot => ({
    start: i * h, kp, live: false, cloud, assessment: assess(activityFor(kp, t), skyFor(cloud)),
  });
  const t = { kpFaint: 3, kpVisible: 4, kpOverhead: 7 };
  const slots = [slot(0, 3, 10, t), slot(1, 4, 60, t), slot(2, 5, 20, t), slot(3, 5, 10, t), slot(4, 2, 0, t)];
  const best = bestSlot(slots);
  assert.equal(best?.start, 3 * h); // go, and the clearer of the two go hours
  assert.deepEqual(windowsFor(slots, 'go'), [[2 * h, 4 * h]]);
  assert.deepEqual(windowsFor(slots, 'maybe'), [[0, 2 * h]]);
  assert.equal(bestSlot([]), null);
});

test('compass words', () => {
  assert.equal(compassWord(189), 'south');
  assert.equal(compassWord(195), 'south-southwest');
  assert.equal(compassWord(359), 'north');
});
