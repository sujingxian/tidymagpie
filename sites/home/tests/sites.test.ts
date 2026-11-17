import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, relative } from 'node:path';
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

test('the AdSense account in the page head is the one ads.txt authorises', () => {
  const account = readFileSync(here('../src/lib/site.ts'), 'utf8').match(/ADSENSE_ACCOUNT = '(ca-pub-\d{16})'/)?.[1];
  assert.ok(account, 'ADSENSE_ACCOUNT should be ca-pub- followed by 16 digits');
  const layout = readFileSync(here('../src/layouts/Base.astro'), 'utf8');
  assert.ok(layout.includes('<meta name="google-adsense-account" content={ADSENSE_ACCOUNT} />'), 'the layout lost the account tag');
  const entries = readFileSync(here('../public/ads.txt'), 'utf8').split('\n').filter((line) => line.trim() !== '');
  assert.deepEqual(entries, [`google.com, ${account.slice('ca-'.length)}, DIRECT, f08c47fec0942fa0`]);
});

// Every site shares one public mailbox. Nothing else that identifies a person or an account belongs in the pages:
// no other email address, and no link to a code repository apart from the open-source projects the sites credit.
const MAILBOX = 'hello@tidymagpie.com';
const CREDITED_REPOSITORIES = ['aburrell/aacgmv2', 'mourner/suncalc'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro', '.wrangler']);
const TEXT = new Set(['.astro', '.ts', '.js', '.mjs', '.json', '.css', '.md', '.txt', '.svg', '.py', '.html']);

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return SKIP_DIRS.has(name) ? [] : textFiles(full);
    return TEXT.has(extname(name)) && name !== 'package-lock.json' ? [full] : [];
  });
}

test('one shared mailbox, and no other address or repository link anywhere on the sites', () => {
  const root = fileURLToPath(here('../../'));
  const files = textFiles(root);
  assert.ok(files.length > 100, 'expected to scan every site folder');
  let mailboxSeen = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const where = relative(root, file);
    for (const [address] of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
      // Calendar entries carry ids shaped like addresses on a site's own subdomain. No mailbox exists there.
      if (/@[a-z]+\.tidymagpie\.com$/.test(address)) continue;
      assert.equal(address, MAILBOX, `${where} contains the address ${address}`);
      mailboxSeen++;
    }
    for (const [, repository] of text.matchAll(/github\.com\/([\w.-]+\/[\w.-]+)/g)) {
      assert.ok(CREDITED_REPOSITORIES.includes(repository), `${where} links to github.com/${repository}`);
    }
  }
  assert.ok(mailboxSeen >= sites.length + 1, 'each site and the homepage should give the mailbox');
  assert.ok(readFileSync(here('../src/lib/site.ts'), 'utf8').includes(`'${MAILBOX}'`));
});
