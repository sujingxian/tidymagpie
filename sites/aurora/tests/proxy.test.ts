import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compact, handleCloud, inBounds, parsePoints, resetGuards, USER_AGENT,
} from '../server/cloud-proxy.js';

const H = 3600000;
const T0 = Date.UTC(2026, 10, 17, 0, 0);

function upstreamBody(from: number, count = 70) {
  const timeseries = [];
  for (let i = 0; i < count; i++) {
    timeseries.push({
      time: new Date(from + i * H).toISOString().replace('.000Z', 'Z'),
      data: { instant: { details: { cloud_area_fraction: i % 101, cloud_area_fraction_low: 48.4, cloud_area_fraction_medium: 2.3, cloud_area_fraction_high: 1.6, air_temperature: 14.1 } } },
    });
  }
  return { type: 'Feature', properties: { meta: { updated_at: '2026-11-16T23:20:38Z' }, timeseries } };
}

function harness() {
  const store = new Map<string, Response>();
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const state = { now: T0, respond: (_url: string, _headers: Record<string, string>): Response => new Response('nope', { status: 500 }) };
  const pending: Promise<unknown>[] = [];
  const deps = {
    now: () => state.now,
    upstream: 'https://met.test/complete',
    fetch: async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return state.respond(url, init.headers);
    },
    cache: {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => { store.set(req.url, res); },
    },
    defer: (p: Promise<unknown>) => { pending.push(p); },
  };
  const ok = () => new Response(JSON.stringify(upstreamBody(state.now - H)), {
    status: 200,
    headers: { expires: new Date(state.now + 30 * 60000).toUTCString(), 'last-modified': 'Mon, 16 Nov 2026 23:50:48 GMT' },
  });
  const get = async (query: string) => {
    const res = await handleCloud(new Request(`https://aurora.test/api/cloud?${query}`), deps);
    await Promise.all(pending.splice(0));
    return res;
  };
  return { deps, calls, state, store, ok, get };
}

test('bounds cover Australia and New Zealand only', () => {
  assert.equal(inBounds(-42.88, 147.33), true);
  assert.equal(inBounds(-36.85, 174.76), true);
  assert.equal(inBounds(-43.95, -176.55), true); // Chatham Islands
  assert.equal(inBounds(59.91, 10.75), false); // Oslo
  assert.equal(inBounds(-34.6, -58.4), false); // Buenos Aires
});

test('point parsing: rounding, duplicates and bad input', () => {
  const url = (q: string) => new URL(`https://x.test/api/cloud?${q}`);
  assert.deepEqual(parsePoints(url('p=-42.8849,147.3271&p=-42.88,147.33&p=-37.81,144.96')).map((p) => p.key), ['-42.88,147.33', '-37.81,144.96']);
  assert.throws(() => parsePoints(url('')), /at least one/);
  assert.throws(() => parsePoints(url('p=hobart')), /look like/);
  assert.throws(() => parsePoints(url('p=-42.88123,147.33')), /look like/); // five decimals
  assert.throws(() => parsePoints(url('p=59.91,10.75')), /Only Australia/);
  assert.throws(() => parsePoints(url(Array.from({ length: 17 }, (_, i) => `p=-40,${140 + i}`).join('&'))), /At most 16/);
});

test('compact keeps the next four days and rounds percentages', () => {
  const out = compact(upstreamBody(T0 - 5 * H, 130), T0);
  assert.ok(out);
  assert.equal(out.updated, '2026-11-16T23:20:38Z');
  assert.equal(out.hours[0][0], Math.round((T0 - 2 * H) / H)); // nothing older than two hours back
  assert.equal(out.hours[out.hours.length - 1][0], Math.round((T0 + 96 * H) / H));
  assert.deepEqual(out.hours[0].slice(1), [3, 48, 2, 2]);
  assert.equal(compact({ nope: true }, T0), null);
  assert.equal(compact(null, T0), null);
});

test('first request fetches, identifies itself and stores; the second is served from the cache', async () => {
  resetGuards();
  const h = harness();
  h.state.respond = () => h.ok();
  const first = await h.get('p=-42.88,147.33');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-cloud-cache'), 'miss');
  assert.equal(first.headers.get('cache-control'), 'public, max-age=300');
  const body = await first.json();
  assert.equal(body.points.length, 1);
  assert.equal(body.points[0].ok, true);
  assert.equal(body.points[0].stale, false);
  assert.ok(body.points[0].hours.length > 60);
  assert.equal('cache' in body.points[0], false);
  assert.match(body.attribution, /MET Norway/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://met.test/complete?lat=-42.88&lon=147.33');
  assert.equal(h.calls[0].headers['User-Agent'], USER_AGENT);
  assert.equal(h.calls[0].headers['If-Modified-Since'], undefined);

  h.state.now += 10 * 60000;
  const second = await h.get('p=-42.88,147.33');
  assert.equal(second.headers.get('x-cloud-cache'), 'hit');
  assert.equal(h.calls.length, 1); // nothing re-requested before Expires
});

test('after Expires the copy is revalidated with If-Modified-Since', async () => {
  resetGuards();
  const h = harness();
  h.state.respond = () => h.ok();
  await h.get('p=-42.88,147.33');
  h.state.now += 31 * 60000;
  h.state.respond = (_url, headers) => {
    assert.equal(headers['If-Modified-Since'], 'Mon, 16 Nov 2026 23:50:48 GMT');
    return new Response(null, { status: 304, headers: { expires: new Date(h.state.now + 30 * 60000).toUTCString() } });
  };
  const res = await h.get('p=-42.88,147.33');
  assert.equal(res.headers.get('x-cloud-cache'), 'revalidated');
  assert.equal((await res.json()).points[0].ok, true);
  h.state.now += 5 * 60000;
  assert.equal((await h.get('p=-42.88,147.33')).headers.get('x-cloud-cache'), 'hit');
  assert.equal(h.calls.length, 2);
});

test('upstream trouble: stale copy if there is one, an honest failure if not', async () => {
  resetGuards();
  const h = harness();
  h.state.respond = () => h.ok();
  await h.get('p=-42.88,147.33');
  h.state.now += 40 * 60000;
  h.state.respond = () => new Response('down', { status: 503 });
  const stale = await h.get('p=-42.88,147.33&p=-37.81,144.96');
  assert.equal(stale.headers.get('x-cloud-cache'), 'stale,none');
  assert.equal(stale.headers.get('cache-control'), 'public, max-age=30');
  const body = await stale.json();
  assert.deepEqual(body.points.map((p: { ok: boolean; stale?: boolean }) => [p.ok, p.stale ?? null]), [[true, true], [false, null]]);
  assert.equal(body.points[1].error, 'upstream 503');
  // A network failure reads the same way.
  h.state.respond = () => { throw new Error('socket'); };
  h.state.now += 60000;
  assert.equal((await (await h.get('p=-41.44,147.14')).json()).points[0].error, 'upstream unreachable');
});

test('a 429 pauses upstream calls for five minutes', async () => {
  resetGuards();
  const h = harness();
  h.state.respond = () => new Response('slow down', { status: 429 });
  assert.equal((await (await h.get('p=-42.88,147.33')).json()).points[0].error, 'upstream 429');
  h.state.respond = () => h.ok();
  h.state.now += 60000;
  assert.equal((await (await h.get('p=-42.88,147.33')).json()).points[0].error, 'busy');
  assert.equal(h.calls.length, 1);
  h.state.now += 5 * 60000;
  assert.equal((await (await h.get('p=-42.88,147.33')).json()).points[0].ok, true);
  assert.equal(h.calls.length, 2);
});

test('the brake caps upstream calls in a burst', async () => {
  resetGuards();
  const h = harness();
  h.state.respond = () => h.ok();
  for (let batch = 0; batch < 3; batch++) {
    await h.get(Array.from({ length: 16 }, (_, i) => `p=-${30 + batch},${120 + i}`).join('&'));
  }
  assert.equal(h.calls.length, 30);
});

test('bad requests get a 400 with a reason and are never cached', async () => {
  resetGuards();
  const h = harness();
  const res = await h.get('p=59.91,10.75');
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match((await res.json()).error, /Only Australia/);
  assert.equal(h.calls.length, 0);
});
