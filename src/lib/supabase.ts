import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { configuredGames } from '../games';

// Each game lives in its own Supabase project (schemas differ per game), so
// there's one client per game. Which games exist and their env vars come from
// src/games/<id>/game.ts; any game can be left unconfigured.
export type GameId = string;

const clients = new Map<GameId, SupabaseClient>();

/** The game's client, or null if the game is missing or its env vars aren't set. */
export function getSupabase(game: GameId): SupabaseClient | null {
  const existing = clients.get(game);
  if (existing) return existing;
  const config = configuredGames.find((g) => g.id === game)?.supabase;
  if (!config?.url || !config.key) return null;
  const client = createClient(config.url, config.key);
  clients.set(game, client);
  return client;
}

/** The game's client, throwing a setup hint if it isn't configured. For pages that can't work without it. */
export function requireSupabase(game: GameId): SupabaseClient {
  const client = getSupabase(game);
  if (!client) {
    throw new Error(`The ${game} game isn't configured. Set its Supabase env vars (see .env.example and src/games/${game}/game.ts).`);
  }
  return client;
}

/** Every configured game's client -- used to log in/out of all of them at once. */
export function configuredClients(): [GameId, SupabaseClient][] {
  return configuredGames.map((game) => [game.id, getSupabase(game.id)!]);
}
