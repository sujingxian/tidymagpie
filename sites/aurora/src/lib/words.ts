// Plain-English wording for verdicts and readings. Pure, so the sentences can be tested.
import { compassWord, kpLevel, type Assessment, type Verdict } from './model.ts';

export const VERDICT_LABEL: Record<Verdict, string> = { go: 'Go', maybe: 'Maybe', no: 'No-go' };

export interface ExplainContext {
  name: string;
  kp: number;
  /** True for the live estimate, false for a forecast value. */
  live: boolean;
  /** The Kp this place needs for a display you can see, or null when Kp 9 is not enough. */
  need: number | null;
  cloud: number | null;
  /** Clock time the value applies to, for forecast sentences ("1 am"). */
  when: string;
  bearing?: number | null;
}

export function lookPhrase(bearing: number | null | undefined): string {
  return `to the ${typeof bearing === 'number' ? compassWord(bearing) : 'south'}`;
}

export function needPhrase(name: string, need: number | null): string {
  return need === null
    ? `${name} is too far north for the Kp scale to promise anything; it takes an extreme storm at the very top of the scale`
    : `${name} usually needs Kp ${need}`;
}

/** One or two sentences that say why the verdict is what it is. */
export function explain(a: Assessment, c: ExplainContext): string {
  const level = kpLevel(c.kp);
  const lead = c.live ? `Kp is about ${level} right now` : `Kp is forecast to reach about ${level} around ${c.when}`;
  const cloud = c.cloud === null ? null : Math.round(c.cloud);
  const look = lookPhrase(c.bearing);
  // "your spot" is a valid name, so capitalise it where it opens a sentence.
  const Name = c.name.charAt(0).toUpperCase() + c.name.slice(1);

  if (c.need === null) {
    // Places where even Kp 9 does not bring the aurora within range by the rule of thumb.
    switch (a.reason) {
      case 'borderline':
        return `${lead}: an extreme storm. ${Name} is normally too far north to see aurora, but at the very top of the scale it is worth a look from a dark spot. Face ${look.replace('to the ', '')}.`;
      case 'borderline-sky-unknown':
        return `${lead}: an extreme storm. ${Name} is normally too far north to see aurora, but at the very top of the scale it is worth a look. The cloud forecast is unavailable, so check the sky yourself.`;
      case 'borderline-cloud':
        return `${lead}: an extreme storm, but ${c.name} is normally too far north to see aurora and about ${cloud}% of the sky ${c.live ? 'is' : 'will be'} covered.`;
      default:
        return `${lead}. ${Name} is too far north for that: it would take an extreme storm at the very top of the Kp scale.`;
    }
  }

  const need = `${c.name} usually needs Kp ${c.need}`;
  // Say what to expect: a storm that reaches overhead, or one that only just clears the bar.
  const strong =
    a.activity === 'overhead'
      ? ' At this level the aurora can climb high into the sky, not just sit on the horizon.'
      : a.activity === 'visible' && level === c.need
        ? ' That only just clears the bar, so expect it low on the horizon and paler to the eye than in photos.'
        : '';
  switch (a.reason) {
    case 'clear':
      return `${lead}, and ${need}. The sky ${c.live ? 'is' : 'should be'} mostly clear (${cloud}% cloud). Get away from town lights and look ${look}.${strong}`;
    case 'partly':
      return `${lead}, and ${need}, so activity is high enough. But about ${cloud}% of the sky ${c.live ? 'is' : 'will be'} covered. Worth it if you can find a gap ${look}.${strong}`;
    case 'sky-unknown':
      return `${lead}, and ${need}, so activity is high enough. The cloud forecast is unavailable, so check the sky yourself before you go.${strong}`;
    case 'blocked':
      return `${lead}, and ${need}, so activity is high enough. But cloud cover ${c.live ? 'is' : 'will be'} about ${cloud}%, which hides it. Try somewhere clearer.`;
    case 'borderline':
      return `${lead}, one step short: ${need}. From a dark spot with a clear view ${look}, a faint glow low on the horizon is possible. A camera will pick it up before your eyes do.`;
    case 'borderline-sky-unknown':
      return `${lead}, one step short: ${need}. A faint glow low ${look} is possible from a dark spot. The cloud forecast is unavailable, so check the sky yourself.`;
    case 'borderline-cloud':
      return `${lead}, one step short: ${need}. With about ${cloud}% cloud on top of that, it is not worth the drive.`;
    case 'faint':
      return `${lead}. ${Name} usually needs Kp ${c.need} for a display you can see. At this level only a camera at a very dark site might catch a glow on the horizon.`;
    default:
      return `${lead}, well short: ${need}.`;
  }
}

/** NOAA's names: Kp 0 to 2 quiet, 3 unsettled, 4 active, 5 and up are storms on the G scale. */
export function kpWord(kp: number): string {
  const level = kpLevel(kp);
  if (level <= 2) return 'quiet';
  if (level === 3) return 'unsettled';
  if (level === 4) return 'active';
  return ['G1 minor storm', 'G2 moderate storm', 'G3 strong storm', 'G4 severe storm', 'G5 extreme storm'][level - 5];
}

export function kpText(kp: number): string {
  return Number.isInteger(kp) ? String(kp) : kp.toFixed(1);
}

export function bzWord(bz: number): string {
  if (bz <= -10) return 'strongly south: good for aurora';
  if (bz <= -3) return 'south: helps aurora';
  if (bz < 0) return 'slightly south';
  if (bz < 3) return 'slightly north';
  return 'north: holds aurora back';
}

export function speedWord(speed: number): string {
  if (speed >= 700) return 'very fast';
  if (speed >= 500) return 'fast';
  if (speed >= 400) return 'average';
  return 'slow';
}

/** Bands as described for NOAA's OVATION model: under 20 GW little to see, over 50 GW plenty. */
export function powerWord(gw: number): string {
  if (gw >= 100) return 'very high';
  if (gw >= 50) return 'high';
  if (gw >= 20) return 'moderate';
  return 'low';
}

export function cloudWord(pct: number): string {
  if (pct <= 30) return 'mostly clear';
  if (pct <= 70) return 'partly cloudy';
  return 'mostly cloudy';
}

export function durationText(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function agoText(then: number, now: number): string {
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}
