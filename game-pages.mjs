// Astro integration that serves each game's own pages. Kept out of
// astro.config.mjs so that file's @ts-check doesn't need Node's type definitions.
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const gamesDir = fileURLToPath(new URL('./src/games/', import.meta.url));

/**
 * Every .astro file under dir, recursively.
 * @param {string} dir
 * @returns {string[]}
 */
function astroFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return astroFiles(path);
    return entry.name.endsWith('.astro') ? [path] : [];
  });
}

/**
 * Each game keeps its own pages in src/games/<id>/pages/, laid out exactly
 * like src/pages/ (src/games/iidx/pages/settings/iidx/new.astro serves
 * /settings/iidx/new). Deleting a game's folder removes its pages too.
 * @returns {import('astro').AstroIntegration}
 */
export function gamePages() {
  return {
    name: 'game-pages',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        for (const game of readdirSync(gamesDir, { withFileTypes: true })) {
          const pagesDir = join(gamesDir, game.name, 'pages');
          if (!game.isDirectory() || !existsSync(pagesDir)) continue;
          for (const file of astroFiles(pagesDir)) {
            const route = relative(pagesDir, file).split('\\').join('/').replace(/\.astro$/, '').replace(/(^|\/)index$/, '');
            injectRoute({ pattern: `/${route}`, entrypoint: file });
          }
        }
      },
    },
  };
}
