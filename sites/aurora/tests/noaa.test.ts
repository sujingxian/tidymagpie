import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kpForTime, parseHemiPower, parseKpForecast, parseKpNow, parseOutlook27, parseSolarWind, parseUtc, parseWindSummary,
} from '../src/lib/noaa.ts';

// Rows below are copied from the live NOAA services on 17 November 2026.

test('time tags without a zone are UTC', () => {
  assert.equal(parseUtc('2026-11-16T23:45:00'), Date.UTC(2026, 10, 16, 23, 45));
  assert.equal(parseUtc('2026-11-16T23:45:00Z'), Date.UTC(2026, 10, 16, 23, 45));
  assert.equal(parseUtc('2026-11-16 23:45:00.000'), Date.UTC(2026, 10, 16, 23, 45));
  assert.ok(Number.isNaN(parseUtc(null)));
});

test('live kp takes the last usable row', () => {
  const json = [
    { estimated_kp: 0.67, kp: '1M', kp_index: 1, time_tag: '2026-11-16T23:44:00' },
    { estimated_kp: 0.33, kp: '0P', kp_index: 0, time_tag: '2026-11-16T23:45:00' },
    { estimated_kp: null, kp: null, kp_index: null, time_tag: '2026-11-16T23:46:00' },
  ];
  assert.deepEqual(parseKpNow(json), { kp: 0.33, time: Date.UTC(2026, 10, 16, 23, 45) });
  assert.equal(parseKpNow([]), null);
  assert.equal(parseKpNow({ error: 'x' }), null);
});

test('kp forecast in both layouts', () => {
  const objects = [
    { kp: 3.67, noaa_scale: null, observed: 'estimated', time_tag: '2026-11-16T21:00:00' },
    { kp: 4.67, noaa_scale: 'G1', observed: 'predicted', time_tag: '2026-11-17T21:00:00' },
    { kp: 2, noaa_scale: null, observed: 'predicted', time_tag: '2026-11-17T00:00:00' },
  ];
  const blocks = parseKpForecast(objects);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((b) => b.kp), [3.67, 2, 4.67]); // sorted by time
  assert.equal(blocks[2].scale, 'G1');
  assert.equal(blocks[0].kind, 'estimated');
  assert.equal(kpForTime(blocks, Date.UTC(2026, 10, 17, 22, 30))?.kp, 4.67);
  assert.equal(kpForTime(blocks, Date.UTC(2026, 10, 18, 0, 0)), null);
  const arrays = [
    ['time_tag', 'kp', 'observed', 'noaa_scale'],
    ['2026-11-17 21:00:00', '4.67', 'predicted', 'G1'],
  ];
  assert.deepEqual(parseKpForecast(arrays).map((b) => [b.kp, b.scale]), [[4.67, 'G1']]);
});

test('solar wind table', () => {
  const header = ['time_tag', 'speed', 'density', 'temperature', 'bx', 'by', 'bz', 'bt', 'vx', 'vy', 'vz', 'propagated_time_tag'];
  const json = [
    header,
    ['2026-11-16T23:46:00Z', 291.7, 2.07, 32268, 3.97, -3.02, 0.6, 5.05, -290.8, -7.6, -21.5, '2026-11-17T00:57:26Z'],
    ['2026-11-16T23:47:00Z', 290.5, 2.07, 32445, 3.85, -2.93, -0.79, 4.91, -289.8, -4.7, -18.6, '2026-11-17T00:58:41Z'],
    ['2026-11-16T23:48:00Z', 291.4, 2.04, 32588, 4.08, -2.81, 1.16, 5.08, -290.7, -4, -20.3, '2026-11-17T00:59:28Z'],
    ['2026-11-16T23:49:00Z', null, null, null, null, null, null, null, null, null, null, null],
  ];
  const wind = parseSolarWind(json);
  assert.ok(wind);
  assert.equal(wind.time, Date.UTC(2026, 10, 16, 23, 48));
  assert.equal(wind.bz, 1.16);
  assert.equal(wind.speed, 291.4);
  assert.equal(wind.density, 2.04);
  assert.equal(wind.arrival, Date.UTC(2026, 10, 17, 0, 59, 28));
  assert.equal(wind.southMinutes30, 1);
  assert.ok(Math.abs((wind.bzMean30 as number) - (0.6 - 0.79 + 1.16) / 3) < 1e-9);
  assert.equal(wind.series.length, 4);
  assert.equal(parseSolarWind([header]), null);
  assert.equal(parseSolarWind('nope'), null);
});

test('solar wind summaries as a fallback', () => {
  const wind = parseWindSummary(
    [{ bt: 5, bz_gsm: 1, time_tag: '2026-11-16T23:48:00Z' }],
    [{ proton_speed: 291, time_tag: '2026-11-16T23:48:00Z' }],
  );
  assert.deepEqual([wind?.bz, wind?.bt, wind?.speed], [1, 5, 291]);
  assert.equal(parseWindSummary(null, null), null);
});

test('hemispheric power', () => {
  const text = [
    '#Aurora Hemispheric Power Tabular Values',
    '# Observation        Forecast            North-Hemispheric-Power-Index    South-Hemispheric-Power-Index-GigaWatts',
    '2026-11-16_23:40    2026-11-17_01:06      11      12',
    '2026-11-16_23:45    2026-11-17_01:11      13      14',
    '',
  ].join('\n');
  assert.deepEqual(parseHemiPower(text), {
    observed: Date.UTC(2026, 10, 16, 23, 45),
    valid: Date.UTC(2026, 10, 17, 1, 11),
    north: 13,
    south: 14,
  });
  assert.equal(parseHemiPower('# only comments\n'), null);
  // A missing value on the last line falls back to the line before.
  assert.equal(parseHemiPower(text + '2026-11-16_23:50    2026-11-17_01:16      n/a      n/a\n')?.south, 14);
});

test('27-day outlook', () => {
  const text = [
    ':Product: 27-day Space Weather Outlook Table 27DO.txt',
    ':Issued: 2026 Nov 16 0233 UTC',
    '#  Date       10.7 cm      A Index    Kp Index',
    '2026 Nov 16     119          15          4',
    '2026 Nov 17     113          20          5',
    '2026 Dec 12     115           5          2',
  ].join('\n');
  const outlook = parseOutlook27(text);
  assert.equal(outlook.issued, '2026 Nov 16 0233 UTC');
  assert.deepEqual(outlook.days, [
    { date: '2026-11-16', kp: 4 },
    { date: '2026-11-17', kp: 5 },
    { date: '2026-12-12', kp: 2 },
  ]);
  assert.deepEqual(parseOutlook27(undefined), { issued: null, days: [] });
});
