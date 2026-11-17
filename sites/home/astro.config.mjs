import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://tidymagpie.com',
  trailingSlash: 'always',
  // HTML compression drops the line break before an inline link ("at\n<a>" becomes "at<a>"),
  // which glues words to links. Keep source whitespace instead.
  compressHTML: false,
  integrations: [sitemap()],
});
