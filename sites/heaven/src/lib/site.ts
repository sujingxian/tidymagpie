import achievementData from '../data/achievements.json';
import actData from '../data/acts.json';
import castData from '../data/cast.json';
import siteData from '../data/site.json';

export const SITE_NAME = 'Stranger Than Heaven Tracker';
export const GAME = 'Stranger Than Heaven';
export const ACH_KEY = 'tm-heaven-achievements-v1';
export const ALL_ID = 'all';
export const site = siteData;

export interface Achievement {
  id: string;
  name: string;
  group: string;
  act: number | null;
  hidden: boolean;
  req: string;
  target: number | null;
  series: string | null;
}

export interface Fact {
  text: string;
  src: string;
}

export interface Act {
  n: number;
  slug: string;
  year: number;
  city: string;
  region: string;
  label: string;
  setting: Fact[];
  story: Fact[];
  activities: Fact[];
}

export interface CastMember {
  id: string;
  name: string;
  performer: string;
  role: string;
  act: number | null;
  about: string;
  src: string[];
}

export const achievements = achievementData.items as Achievement[];
export const groups = achievementData.groups as Array<{ id: string; name: string; blurb: string }>;
export const listMeta = { surfaced: achievementData.surfaced, checked: achievementData.checked, total: achievementData.total, hidden: achievementData.hiddenCount };
export const acts = actData as Act[];
export const cast = castData as CastMember[];

export const inGroup = (id: string) => achievements.filter((a) => a.group === id);
export const inAct = (n: number) => achievements.filter((a) => a.act === n);
export const anyTime = achievements.filter((a) => a.act === null && a.id !== ALL_ID);
export const castInAct = (n: number) => cast.filter((c) => c.act === n);
export const actBy = (n: number) => acts.find((a) => a.n === n) as Act;

/** The slim records the tick-list script needs to know about every achievement. */
export const universe = achievements.map(({ id, group, act, hidden }) => ({ id, group, act, hidden }));

const sourceIndex = new Map(site.sources.map((s) => [s.id, s]));
export const source = (id: string) => sourceIndex.get(id);
export const sourceShort = (id: string) => sourceIndex.get(id)?.short ?? id;

export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d} ${months[m - 1]} ${y}`;
}
