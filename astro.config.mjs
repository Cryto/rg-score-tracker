// @ts-check
import { defineConfig } from 'astro/config';
import { gamePages } from './game-pages.mjs';

// https://astro.build/config
export default defineConfig({
  integrations: [gamePages()],
});
