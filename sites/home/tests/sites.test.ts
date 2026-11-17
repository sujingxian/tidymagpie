import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { host, longDate } from '../src/lib/format.ts';

const here = (path: string) => new URL(path, import.meta.url);
const data = JSON.parse(readFileSync(here('../src/data/sites.json'), 'utf8'));
const sites: Array<Record<string, string>> = data.sites;

test('every listed site is a real folder in this repository, on its own subdomain', () => {
  assert.ok(sites.length >= 3);
  assert.equal(new Set(sites.map((s) => s.slug)).size, sites.length);
  for (const s of sites) {
    assert.match(s.slug, /^[a-z]+$/);
    assert.equal(s.url, `https://${s.slug}.tidymagpie.com/`);
    const config = here(`../../${s.slug}/astro.config.mjs`);
    assert.ok(existsSync(config), `sites/${s.slug} is missing`);
    assert.ok(readFileSync(config, 'utf8').includes(`site: 'https://${s.slug}.tidymagpie.com'`), `sites/${s.slug} is not configured for ${s.url}`);
    assert.ok(existsSync(here(`../../${s.slug}/src/pages/privacy.astro`)), `${s.slug} has no privacy page to link to`);
  }
});

test('the picture on each shelf is that site\'s own icon', () => {
  for (const s of sites) {
    const ours = readFileSync(here(`../src/emblems/${s.slug}.svg`), 'utf8');
    const theirs = readFileSync(here(`../../${s.slug}/public/favicon.svg`), 'utf8');
    assert.equal(ours, theirs, `${s.slug}: copy sites/${s.slug}/public/favicon.svg to src/emblems/${s.slug}.svg`);
  }
  const component = readFileSync(here('../src/components/Emblem.astro'), 'utf8');
  for (const s of sites) assert.ok(component.includes(`../emblems/${s.slug}.svg?raw`), `Emblem.astro does not know ${s.slug}`);
});

test('descriptions are complete sentences and dates are real', () => {
  for (const s of sites) {
    for (const key of ['subject', 'inside', 'status']) {
      assert.match(s[key], /^[A-Z].*\.$/, `${s.slug}.${key}`);
      assert.ok(!/[—–]/.test(s[key]), `${s.slug}.${key} has a dash`);
    }
    assert.match(s.opened, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(s.opened)));
    assert.ok(s.opened <= data.updated, `${s.slug} opened after the last update`);
  }
  assert.match(data.updated, /^\d{4}-\d{2}-\d{2}$/);
});

test('helpers', () => {
  assert.equal(longDate('2026-11-17'), '17 November 2026');
  assert.equal(longDate('2027-01-05'), '5 January 2027');
  assert.equal(host('https://petit.tidymagpie.com/'), 'petit.tidymagpie.com');
});
