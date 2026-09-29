// Shape every game folder's game.ts exports. The shared pages (nav, home,
// login, settings) only know about games through this, so adding a game is
// adding a folder and removing one is deleting its folder.

export type SettingsLink = { href: string; title: string; description: string };

export type GameDefinition = {
  /** Short id, also the key passed to getSupabase(). */
  id: string;
  name: string;
  /** Line under the name on the home page card. */
  subtitle: string;
  /** The game's page, e.g. '/iidx'. */
  route: string;
  /** Sort position in the nav and on the home page. */
  order: number;
  /** Home card picture, hotlinked from the game's official site (never committed). */
  picture?: string;
  /** Used if `picture` fails to load. */
  pictureFallback?: string;
  /** Listed as a placeholder even without a database. */
  comingSoon?: boolean;
  /**
   * The game's own Supabase project. Read import.meta.env with literal names
   * here so Astro/Vite can inline them at build time. Unset means the game is
   * turned off: it's left out of the nav, home page, login and settings.
   */
  supabase?: { url?: string; key?: string };
  /** Cards shown under this game's heading on /settings. */
  settingsLinks?: SettingsLink[];
};
