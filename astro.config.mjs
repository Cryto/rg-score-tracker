// @ts-check
import { defineConfig } from 'astro/config';
import { gamePages } from './game-pages.mjs';

// https://astro.build/config
export default defineConfig({
  integrations: [gamePages()],
  // Astro's HTML compressor drops the line break between text and an inline
  // tag ("matched\n<strong>case" renders as "matchedcase"), gluing words together.
  compressHTML: false,
});
