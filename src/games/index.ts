import type { GameDefinition } from './types';

export type { GameDefinition, SettingsLink } from './types';

// Every src/games/<id>/game.ts is picked up automatically, so deleting a
// game's folder removes it from the site with no other edits.
const modules = import.meta.glob<{ default: GameDefinition }>('./*/game.ts', { eager: true });

/** Every game folder present in the repo, in nav order. */
export const allGames: GameDefinition[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.order - b.order);

/** True when the game's Supabase env vars are set. */
export const isConfigured = (game: GameDefinition) => Boolean(game.supabase?.url && game.supabase?.key);

/** Games with a database set up. */
export const configuredGames = allGames.filter(isConfigured);

/** Games to show in the nav and on the home page: configured ones plus coming-soon placeholders. */
export const listedGames = allGames.filter((game) => isConfigured(game) || game.comingSoon);
