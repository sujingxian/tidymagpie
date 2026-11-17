import data from '../data/sites.json';

export { host, longDate } from './format.ts';

export const BRAND = 'Tidy Magpie';
export const ORIGIN = 'https://tidymagpie.com';
export const REPO = 'https://github.com/sujingxian/tidymagpie';
export const ISSUES = `${REPO}/issues`;

export interface Site {
  slug: string;
  name: string;
  url: string;
  subject: string;
  inside: string;
  status: string;
  opened: string;
}

export const sites = data.sites as Site[];
export const updated = data.updated;
