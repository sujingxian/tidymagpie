import data from '../data/locations.json';
import siteData from '../data/site.json';

export const SITE_NAME = 'Aurora Go/No-Go';
export const site = siteData;

export interface LocationRecord {
  slug: string;
  name: string;
  region: string;
  area: string;
  country: 'AU' | 'NZ';
  lat: number;
  lon: number;
  tz: string;
  featured: boolean;
  mlat: number;
  kpFaint: number | null;
  kpVisible: number | null;
  kpOverhead: number | null;
  bearing: number;
}

export interface RegionRecord {
  slug: string;
  name: string;
  country: 'AU' | 'NZ';
}

export const locations = data.locations as LocationRecord[];
export const regions = data.regions as RegionRecord[];
export const model = {
  epoch: data.epoch,
  kpBoundary: data.kpBoundary,
  easyMarginDeg: data.easyMarginDeg,
  farMarginDeg: data.farMarginDeg,
};

export const featured = locations.filter((l) => l.featured);
export const inRegion = (slug: string) => locations.filter((l) => l.region === slug);
export const regionOf = (l: LocationRecord) => regions.find((r) => r.slug === l.region) as RegionRecord;

/** The fields the browser script needs for one place. */
export function placeFor(l: LocationRecord) {
  const { slug, name, lat, lon, tz, mlat, kpFaint, kpVisible, kpOverhead, bearing } = l;
  return { slug, name, lat, lon, tz, mlat, kpFaint, kpVisible, kpOverhead, bearing };
}

export const kpOrBeyond = (kp: number | null) => (kp === null ? 'Beyond Kp 9' : `Kp ${kp}`);

export function compass(bearing: number): string {
  const words = [
    'north', 'north-northeast', 'northeast', 'east-northeast',
    'east', 'east-southeast', 'southeast', 'south-southeast',
    'south', 'south-southwest', 'southwest', 'west-southwest',
    'west', 'west-northwest', 'northwest', 'north-northwest',
  ];
  return words[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

/** Lowest and highest "display you can see" Kp across a set of places, for summary sentences. */
export function kpSpread(list: LocationRecord[]) {
  const values = list.map((l) => l.kpVisible);
  const known = values.filter((v): v is number => v !== null);
  return {
    min: known.length ? Math.min(...known) : null,
    max: known.length ? Math.max(...known) : null,
    beyond: values.filter((v) => v === null).length,
  };
}

const ZONE_NAMES: Record<string, string> = {
  'Australia/Hobart': 'Tasmanian time (AEST/AEDT)',
  'Australia/Melbourne': 'Victorian time (AEST/AEDT)',
  'Australia/Adelaide': 'South Australian time (ACST/ACDT)',
  'Australia/Perth': 'Western Australian time (AWST)',
  'Australia/Sydney': 'Sydney and Canberra time (AEST/AEDT)',
  'Australia/Brisbane': 'Queensland time (AEST, no daylight saving)',
  'Pacific/Auckland': 'New Zealand time (NZST/NZDT)',
};
export const zoneName = (tz: string) => ZONE_NAMES[tz] ?? tz;
