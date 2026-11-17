// Pure helpers for tick lists. No browser APIs, so they can be unit tested.

export interface TrackItem {
  id: string;
  group: string;
  act: number | null;
  hidden: boolean;
}

/**
 * Keep only known ids. When the list has an "everything else" entry (allId), it is never ticked by
 * hand: it is set exactly when every other entry is ticked.
 */
export function normalise(done: Iterable<string>, items: TrackItem[], allId: string | null): Set<string> {
  const known = new Set(items.map((item) => item.id));
  const out = new Set<string>();
  for (const id of done) if (known.has(id) && id !== allId) out.add(id);
  if (allId && known.has(allId)) {
    const others = items.filter((item) => item.id !== allId);
    if (others.length > 0 && others.every((item) => out.has(item.id))) out.add(allId);
  }
  return out;
}

export function tally(done: Set<string>, items: TrackItem[]): { done: number; total: number } {
  return { done: items.filter((item) => done.has(item.id)).length, total: items.length };
}

export function tallyByGroup(done: Set<string>, items: TrackItem[]): Record<string, { done: number; total: number }> {
  const out: Record<string, { done: number; total: number }> = {};
  for (const item of items) {
    const entry = (out[item.group] ??= { done: 0, total: 0 });
    entry.total++;
    if (done.has(item.id)) entry.done++;
  }
  return out;
}

export interface Filter {
  /** A group id, or "all". */
  group: string;
  /** "all", "any" for entries tied to no act, or an act number as text. */
  act: string;
  hideDone: boolean;
}

export function matches(item: TrackItem, filter: Filter, done: Set<string>): boolean {
  if (filter.group !== 'all' && item.group !== filter.group) return false;
  if (filter.act === 'any' && item.act !== null) return false;
  if (filter.act !== 'all' && filter.act !== 'any' && String(item.act) !== filter.act) return false;
  if (filter.hideDone && done.has(item.id)) return false;
  return true;
}

export function percent(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/** Whole days from now until local midnight at the start of the given date (YYYY-MM-DD). Never negative. */
export function daysUntil(dateText: string, now: Date): number {
  const [y, m, d] = dateText.split('-').map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((target - today) / 86400000));
}
