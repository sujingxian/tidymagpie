// GET /api/cloud?p=lat,lon&p=lat,lon ... : cloud cover for up to 16 points, cached at the edge.
import { handleCloud, UPSTREAM_URL } from '../../server/cloud-proxy.js';

export function onRequestGet(context) {
  return handleCloud(context.request, {
    fetch: (url, init) => fetch(url, init),
    cache: caches.default,
    defer: (promise) => context.waitUntil(promise),
    now: () => Date.now(),
    // MET_API_URL is only for local testing against a stand-in server.
    upstream: (context.env && context.env.MET_API_URL) || UPSTREAM_URL,
  });
}
