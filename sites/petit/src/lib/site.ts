import site from '../data/site.json';
import neighbors from '../data/neighbors.json';

export const SITE_NAME = 'Tidy Magpie · Petit Planet';

export type Neighbor = (typeof neighbors)[number];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatBirthday(md: string | null): string {
  if (!md) return 'No reliable record yet';
  const [m, d] = md.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function monthName(m: number): string {
  return MONTHS[m - 1];
}

/** Chinese name for a gift tag when a Chinese-language source confirms it, else null. */
export function tagZh(tag: string): string | null {
  return (site.tagZh as Record<string, string>)[tag] ?? null;
}

export const invite = neighbors.filter((n) => n.type === 'invite');
export const base = neighbors.filter((n) => n.type === 'base');

/** Every tag that appears in any liked or disliked list, sorted. */
export const allTags = [...new Set(invite.flatMap((n) => [...n.liked, ...n.disliked]))].sort((a, b) => a.localeCompare(b));

/** Loved items that both an English and a Chinese source list. */
export function crossChecked(n: Neighbor): number {
  return n.loved.filter((i) => i.zh).length;
}

export { site, neighbors };
