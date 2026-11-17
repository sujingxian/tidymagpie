// Local preview that also answers /api/cloud, which the plain `astro preview` cannot do.
//
//   npm run build && node scripts/dev-server.mjs            # stand-in cloud data, no network needed
//   npm run build && node scripts/dev-server.mjs --real     # ask MET Norway for real forecasts
//   node scripts/dev-server.mjs --cloud-pct=10               # stand-in with the same cloud cover everywhere
//   node scripts/dev-server.mjs --cloud-down                 # make every cloud request fail
//   node scripts/dev-server.mjs --now=2026-11-16T23:00:00Z   # pin the server clock (used by the smoke test)
//
// The stand-in data is made up (a smooth pattern that differs by place and hour). It exists to
// exercise the page, never to be shown to anyone as a forecast.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleCloud, UPSTREAM_URL } from '../server/cloud-proxy.js';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 4321);
const real = process.argv.includes('--real');
const failCloud = process.argv.includes('--cloud-down');
const fixedPct = process.argv.find((a) => a.startsWith('--cloud-pct='));
const fixedCloud = fixedPct ? Number(fixedPct.split('=')[1]) : null;
const nowArg = process.argv.find((a) => a.startsWith('--now='));
const fixedNow = nowArg ? Date.parse(nowArg.slice(6)) : null;
const clock = () => fixedNow ?? Date.now();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
};

function standIn(url) {
  const u = new URL(url);
  const lat = Number(u.searchParams.get('lat'));
  const lon = Number(u.searchParams.get('lon'));
  const start = Math.floor(clock() / 3600000) * 3600000;
  const timeseries = [];
  for (let i = 0; i < 90; i++) {
    const t = start + (i < 62 ? i : 62 + (i - 62) * 6) * 3600000;
    const wave = 50 + 45 * Math.sin(lat * 3.1 + lon * 1.7 + (t / 3600000) * 0.35);
    const total = fixedCloud ?? Math.max(0, Math.min(100, wave));
    timeseries.push({
      time: new Date(t).toISOString().replace('.000Z', 'Z'),
      data: { instant: { details: { cloud_area_fraction: total, cloud_area_fraction_low: total * 0.6, cloud_area_fraction_medium: total * 0.3, cloud_area_fraction_high: total * 0.2 } } },
    });
  }
  const body = { type: 'Feature', properties: { meta: { updated_at: new Date(start).toISOString() }, timeseries } };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', expires: new Date(clock() + 30 * 60000).toUTCString(), 'last-modified': new Date(start).toUTCString() },
  });
}

const memory = new Map();
const deps = {
  now: clock,
  upstream: process.env.MET_API_URL || UPSTREAM_URL,
  fetch: (url, init) => (failCloud ? Promise.resolve(new Response('down', { status: 503 })) : real ? fetch(url, init) : Promise.resolve(standIn(url))),
  cache: {
    match: async (request) => memory.get(request.url)?.clone(),
    put: async (request, response) => void memory.set(request.url, response),
  },
  defer: (promise) => void promise,
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/cloud') {
      const response = await handleCloud(new Request(url), deps);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    let status = 200;
    let body;
    try {
      body = await readFile(join(root, path));
    } catch {
      status = 404;
      path = '/404.html';
      body = await readFile(join(root, '404.html'));
    }
    res.writeHead(status, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(error));
  }
}).listen(port, () => console.log(`http://localhost:${port}  (cloud data: ${failCloud ? 'failing on purpose' : real ? 'MET Norway' : 'stand-in'})`));
