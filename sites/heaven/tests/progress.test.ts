import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, matches, normalise, percent, tally, tallyByGroup, type TrackItem } from '../src/lib/progress.ts';

const items: TrackItem[] = [
  { id: 'all', group: 'completion', act: null, hidden: false },
  { id: 'a', group: 'story', act: 1, hidden: true },
  { id: 'b', group: 'story', act: 2, hidden: true },
  { id: 'c', group: 'combat', act: null, hidden: false },
];

test('unknown ids are dropped and the completion entry cannot be ticked by hand', () => {
  assert.deepEqual([...normalise(['a', 'zzz', 'all'], items, 'all')], ['a']);
});

test('the completion entry follows the rest', () => {
  assert.equal(normalise(['a', 'b'], items, 'all').has('all'), false);
  assert.equal(normalise(['a', 'b', 'c'], items, 'all').has('all'), true);
  assert.equal(normalise(['c', 'b', 'a', 'all'], items, 'all').size, 4);
  // A list with no completion entry behaves like a plain checklist.
  assert.deepEqual([...normalise(['a', 'all'], items, null)].sort(), ['a', 'all']);
});

test('tallies', () => {
  const done = normalise(['a', 'c'], items, 'all');
  assert.deepEqual(tally(done, items), { done: 2, total: 4 });
  assert.deepEqual(tallyByGroup(done, items), { completion: { done: 0, total: 1 }, story: { done: 1, total: 2 }, combat: { done: 1, total: 1 } });
  assert.equal(percent(2, 4), 50);
  assert.equal(percent(0, 0), 0);
  assert.equal(percent(58, 59), 98);
});

test('filters', () => {
  const done = new Set(['a']);
  const all = { group: 'all', act: 'all', hideDone: false };
  assert.equal(items.filter((i) => matches(i, all, done)).length, 4);
  assert.deepEqual(items.filter((i) => matches(i, { ...all, group: 'story' }, done)).map((i) => i.id), ['a', 'b']);
  assert.deepEqual(items.filter((i) => matches(i, { ...all, act: '2' }, done)).map((i) => i.id), ['b']);
  assert.deepEqual(items.filter((i) => matches(i, { ...all, act: 'any' }, done)).map((i) => i.id), ['all', 'c']);
  assert.deepEqual(items.filter((i) => matches(i, { ...all, hideDone: true }, done)).map((i) => i.id), ['all', 'b', 'c']);
  assert.deepEqual(items.filter((i) => matches(i, { group: 'story', act: '1', hideDone: true }, done)), []);
});

test('countdown counts calendar days and stops at zero', () => {
  assert.equal(daysUntil('2027-01-15', new Date(2026, 10, 17, 12, 0)), 59);
  assert.equal(daysUntil('2027-01-15', new Date(2027, 0, 14, 23, 59)), 1);
  assert.equal(daysUntil('2027-01-15', new Date(2027, 0, 15, 0, 1)), 0);
  assert.equal(daysUntil('2027-01-15', new Date(2027, 1, 1)), 0);
});
