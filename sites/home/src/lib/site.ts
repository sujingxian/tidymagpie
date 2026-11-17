import data from '../data/sites.json';

export { host, longDate } from './format.ts';

export const BRAND = 'Tidy Magpie';
export const ORIGIN = 'https://tidymagpie.com';
/** The one public contact address, used on every site. */
export const CONTACT = 'hello@tidymagpie.com';
/**
 * The Google AdSense account this domain is registered under. It goes in the page head, where Google reads it to
 * confirm who owns the site, and it has to match public/ads.txt. It is a label only: it loads nothing.
 */
export const ADSENSE_ACCOUNT = 'ca-pub-7177958455973202';

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
