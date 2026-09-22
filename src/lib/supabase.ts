import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Each game lives in its own Supabase project (schemas differ per game), so
// there's one client per game. IIDX keeps the original, unsuffixed env var
// names; other games are optional and stay disabled until configured.
export type GameId = 'iidx' | 'holodori';

// import.meta.env must be read with literal property names so Astro/Vite can
// inline them at build time -- no dynamic lookups here.
const configs: Record<GameId, { url?: string; key?: string }> = {
  iidx: { url: import.meta.env.PUBLIC_SUPABASE_URL, key: import.meta.env.PUBLIC_SUPABASE_ANON_KEY },
  holodori: { url: import.meta.env.PUBLIC_SUPABASE_URL_HOLODORI, key: import.meta.env.PUBLIC_SUPABASE_ANON_KEY_HOLODORI },
};

const clients = new Map<GameId, SupabaseClient>();

/** The game's client, or null if its env vars aren't set. */
export function getSupabase(game: GameId): SupabaseClient | null {
  const existing = clients.get(game);
  if (existing) return existing;
  const { url, key } = configs[game];
  if (!url || !key) return null;
  const client = createClient(url, key);
  clients.set(game, client);
  return client;
}

/** Every configured game's client -- used to log in/out of all of them at once. */
export function configuredClients(): [GameId, SupabaseClient][] {
  return (Object.keys(configs) as GameId[])
    .map((game) => [game, getSupabase(game)] as [GameId, SupabaseClient | null])
    .filter((entry): entry is [GameId, SupabaseClient] => entry[1] !== null);
}

const iidx = getSupabase('iidx');
if (!iidx) {
  throw new Error(
    'Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project values.'
  );
}

/** The IIDX client (the original single-project export, kept for existing pages). */
export const supabase = iidx;
