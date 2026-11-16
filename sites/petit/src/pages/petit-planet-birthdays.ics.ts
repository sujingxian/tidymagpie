import type { APIRoute } from 'astro';
import { neighbors, site } from '../lib/site';

// One yearly all-day event per neighbor with a known birthday.
export const GET: APIRoute = () => {
  const stamp = `${site.updated.replace(/-/g, '')}T000000Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tidy Magpie//Petit Planet Birthdays//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Petit Planet birthdays',
  ];
  for (const n of neighbors) {
    if (!n.birthday) continue;
    const [m, d] = n.birthday.split('-');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${n.id}-birthday@petit.tidymagpie.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:2026${m}${d}`,
      'RRULE:FREQ=YEARLY',
      `SUMMARY:${n.name}'s birthday (Petit Planet)`,
      `DESCRIPTION:Beta data\\, may change at launch. https://petit.tidymagpie.com/neighbors/${n.id}/`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
};
