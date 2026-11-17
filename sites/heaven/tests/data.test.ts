import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (name: string) => JSON.parse(readFileSync(new URL(`../src/data/${name}.json`, import.meta.url), 'utf8'));
const list = load('achievements');
const acts = load('acts');
const cast = load('cast');
const site = load('site');
const items: Array<{ id: string; name: string; group: string; act: number | null; hidden: boolean; req: string; target: number | null; series: string | null }> = list.items;

test('the list has 59 entries with unique ids and names', () => {
  assert.equal(items.length, 59);
  assert.equal(list.total, 59);
  assert.equal(new Set(items.map((i) => i.id)).size, 59);
  assert.equal(new Set(items.map((i) => i.name)).size, 59);
});

test('the 13 hidden entries are the chapter and act achievements', () => {
  const hidden = items.filter((i) => i.hidden);
  assert.equal(hidden.length, 13);
  assert.equal(list.hiddenCount, 13);
  assert.ok(hidden.every((i) => i.group === 'story' && i.act !== null));
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => hidden.filter((i) => i.act === n).length), [3, 3, 3, 3, 1]);
  assert.equal(items.find((i) => i.id === 'story-final')?.hidden, false);
});

test('group sizes add up', () => {
  const size = (g: string) => items.filter((i) => i.group === g).length;
  assert.deepEqual(
    list.groups.map((g: { id: string }) => [g.id, size(g.id)]),
    [['completion', 1], ['story', 14], ['substories', 5], ['livelihood', 3], ['showbiz', 10], ['combat', 9], ['weapons', 8], ['underworld', 4], ['leisure', 5]],
  );
  assert.ok(items.every((i) => list.groups.some((g: { id: string }) => g.id === i.group)));
});

test('each act has its own short list', () => {
  const per = (n: number) => items.filter((i) => i.act === n).map((i) => i.group).sort();
  for (const n of [1, 2, 3, 4]) assert.deepEqual(per(n), ['showbiz', 'story', 'story', 'story', 'substories', 'underworld']);
  assert.deepEqual(per(5), ['showbiz', 'story', 'story', 'substories']);
  assert.equal(items.filter((i) => i.act === null).length, 59 - 6 * 4 - 4);
});

test('requirements are full sentences and the numbers in them match the targets', () => {
  for (const i of items) {
    assert.match(i.req, /^[A-Z].*\.$/, i.id);
    if (i.target !== null) assert.ok(i.req.replace(/,/g, '').includes(String(i.target)), `${i.id}: ${i.req}`);
  }
});

test('tiered chains climb', () => {
  const chains = new Map<string, number[]>();
  for (const i of items) if (i.series) chains.set(i.series, [...(chains.get(i.series) ?? []), i.target as number]);
  assert.equal(chains.size, 8);
  for (const [name, steps] of chains) {
    assert.ok(steps.length >= 2, name);
    assert.deepEqual(steps, [...steps].sort((a, b) => a - b), name);
  }
  assert.deepEqual(chains.get('kills'), [100, 300, 1000]);
  assert.deepEqual(chains.get('collect'), [30, 70]);
});

test('acts, cast and sources hang together', () => {
  assert.deepEqual(acts.map((a: { n: number; year: number; city: string }) => [a.n, a.year, a.city]), [[1, 1915, 'Kokura'], [2, 1929, 'Kure'], [3, 1943, 'Osaka'], [4, 1951, 'Atami'], [5, 1965, 'Shinjuku']]);
  for (const act of acts) {
    const sub = items.find((i) => i.id === `sub-${act.n}`);
    assert.ok(sub && sub.name === `Fate (${act.city})`, `Act ${act.n} substory entry is named for ${act.city}`);
    assert.match(act.slug, /^act-[1-5]-[a-z]+-19\d\d$/);
  }
  assert.equal(cast.length, 17);
  assert.equal(new Set(cast.map((c: { id: string }) => c.id)).size, 17);
  const ids = new Set(site.sources.map((s: { id: string }) => s.id));
  const used = [
    ...cast.flatMap((c: { src: string[] }) => c.src),
    ...acts.flatMap((a: Record<string, Array<{ src: string }>>) => ['setting', 'story', 'activities'].flatMap((k) => a[k].map((f) => f.src))),
    ...site.timeline.map((t: { src: string }) => t.src),
  ];
  for (const id of used) assert.ok(ids.has(id), `unknown source ${id}`);
  for (const s of site.sources) assert.match(s.url, /^https:\/\//);
  assert.ok(cast.every((c: { act: number | null }) => c.act === null || (c.act >= 1 && c.act <= 5)));
});

test('nothing reads as copied boilerplate from the game data', () => {
  // Requirements are written in the imperative; the game's own text uses the past tense ("Completed ...").
  assert.ok(items.every((i) => !/^(Completed|Unlocked|Obtained|Defeated|Learned|Reached|Played|Performed)\b/.test(i.req)));
});
