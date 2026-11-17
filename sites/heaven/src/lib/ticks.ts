// Browser glue for every tick list on the site: the achievement tracker, the per-act lists and the
// launch checklist. Ticks live in this browser's local storage and nowhere else.
import { daysUntil, matches, normalise, percent, tally, tallyByGroup, type Filter, type TrackItem } from './progress.ts';

const PREFS_KEY = 'tm-heaven-prefs-v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full store: ticks still work until the page is closed.
  }
}

function setupList(root: HTMLElement): void {
  const key = root.dataset.ticklist as string;
  const allId = root.dataset.allId || null;
  // Lists on different pages share one store. `universe` is every id that store may hold.
  const universe: TrackItem[] = JSON.parse(root.dataset.universe || '[]');
  const rows = [...root.querySelectorAll<HTMLElement>('[data-item]')];
  const shown: TrackItem[] = rows.map((row) => ({
    id: row.dataset.item as string,
    group: row.dataset.group || '',
    act: row.dataset.act ? Number(row.dataset.act) : null,
    hidden: row.dataset.hidden === 'true',
  }));
  const everything = universe.length ? universe : shown;
  let done = normalise(read<string[]>(key, []), everything, allId);
  const filter: Filter = { group: 'all', act: 'all', hideDone: false };
  const prefs = read<{ reveal?: boolean; hideDone?: boolean }>(PREFS_KEY, {});
  filter.hideDone = Boolean(prefs.hideDone) && root.querySelector('[data-pref="hideDone"]') !== null;

  const draw = () => {
    let visible = 0;
    rows.forEach((row, index) => {
      const item = shown[index];
      const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const ticked = done.has(item.id);
      if (box) {
        box.checked = ticked;
        if (item.id === allId) box.disabled = true;
      }
      row.classList.toggle('done', ticked);
      const show = matches(item, filter, done);
      row.hidden = !show;
      if (show) visible++;
    });
    root.querySelectorAll<HTMLElement>('[data-section]').forEach((section) => {
      section.hidden = section.querySelectorAll('[data-item]:not([hidden])').length === 0;
    });
    const here = tally(done, shown);
    const overall = tally(done, everything);
    root.querySelectorAll<HTMLElement>('[data-progress-text]').forEach((node) => {
      node.textContent = `${here.done} of ${here.total} done (${percent(here.done, here.total)}%)`;
    });
    root.querySelectorAll<HTMLProgressElement>('progress[data-progress]').forEach((bar) => {
      bar.max = here.total;
      bar.value = here.done;
    });
    root.querySelectorAll<HTMLElement>('[data-overall-text]').forEach((node) => {
      node.textContent = `${overall.done} of ${overall.total}`;
    });
    const groups = tallyByGroup(done, shown);
    root.querySelectorAll<HTMLElement>('[data-group-count]').forEach((node) => {
      const entry = groups[node.dataset.groupCount as string];
      if (entry) node.textContent = `${entry.done}/${entry.total}`;
    });
    const empty = root.querySelector<HTMLElement>('[data-empty]');
    if (empty) empty.hidden = visible !== 0;
  };

  const save = () => write(key, [...done].filter((id) => id !== allId));

  root.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      const row = target.closest<HTMLElement>('[data-item]');
      if (row) {
        const id = row.dataset.item as string;
        const next = new Set(done);
        if (target.checked) next.add(id);
        else next.delete(id);
        done = normalise(next, everything, allId);
        save();
        draw();
        return;
      }
      const pref = target.dataset.pref;
      if (pref === 'hideDone') {
        filter.hideDone = target.checked;
        write(PREFS_KEY, { ...read(PREFS_KEY, {}), hideDone: target.checked });
        draw();
      } else if (pref === 'reveal') {
        root.classList.toggle('reveal', target.checked);
        write(PREFS_KEY, { ...read(PREFS_KEY, {}), reveal: target.checked });
      }
    }
    if (target instanceof HTMLSelectElement && target.dataset.filter === 'act') {
      filter.act = target.value;
      draw();
    }
  });

  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.filterGroup !== undefined) {
      filter.group = button.dataset.filterGroup;
      root.querySelectorAll<HTMLButtonElement>('button[data-filter-group]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      draw();
    }
    if (button.dataset.reset !== undefined) {
      // Two presses, so a slip of the thumb cannot wipe a playthrough.
      if (button.dataset.armed === 'true') {
        done = normalise([], everything, allId);
        save();
        draw();
        button.dataset.armed = 'false';
        button.textContent = button.dataset.label || 'Clear all ticks';
      } else {
        button.dataset.label = button.textContent || '';
        button.dataset.armed = 'true';
        button.textContent = 'Press again to clear every tick';
        window.setTimeout(() => {
          button.dataset.armed = 'false';
          button.textContent = button.dataset.label || 'Clear all ticks';
        }, 5000);
      }
    }
  });

  // Another tab ticked something: follow it.
  window.addEventListener('storage', (event) => {
    if (event.key === key) {
      done = normalise(read<string[]>(key, []), everything, allId);
      draw();
    }
  });

  const reveal = root.querySelector<HTMLInputElement>('[data-pref="reveal"]');
  if (reveal) {
    reveal.checked = Boolean(prefs.reveal);
    root.classList.toggle('reveal', reveal.checked);
  }
  const hide = root.querySelector<HTMLInputElement>('[data-pref="hideDone"]');
  if (hide) hide.checked = filter.hideDone;
  // The hash can preselect an act, as in /achievements/#act-3.
  const actSelect = root.querySelector<HTMLSelectElement>('select[data-filter="act"]');
  const hashAct = /^#act-([1-5])$/.exec(window.location.hash);
  if (actSelect && hashAct) {
    actSelect.value = hashAct[1];
    filter.act = hashAct[1];
  }
  root.classList.add('ready');
  draw();
}

function setupCountdowns(): void {
  document.querySelectorAll<HTMLElement>('[data-countdown]').forEach((node) => {
    const days = daysUntil(node.dataset.countdown as string, new Date());
    const number = node.querySelector<HTMLElement>('[data-days]');
    const label = node.querySelector<HTMLElement>('[data-days-label]');
    if (number) number.textContent = days === 0 ? 'Out now' : String(days);
    if (label) label.textContent = days === 0 ? '' : days === 1 ? 'day to go' : 'days to go';
  });
}

function start(): void {
  document.querySelectorAll<HTMLElement>('[data-ticklist]').forEach(setupList);
  setupCountdowns();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
