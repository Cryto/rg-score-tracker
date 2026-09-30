// Writes db/holodori/catalog.json from the live Holodori Supabase project: the
// song list and chart levels a fork loads with import-catalog.mjs.
//
// Reads only the `songs` and `charts` tables (public read, so the anon key is
// enough); scores, score_attempts and catalog_syncs are never touched. Output
// has no database ids and is sorted by official order, then title, so a
// re-export's diff shows exactly what changed. Null fields are left out.
//
// Requires in .env: PUBLIC_SUPABASE_URL_HOLODORI, PUBLIC_SUPABASE_ANON_KEY_HOLODORI
// Usage: node --env-file=.env db/holodori/export-catalog.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { DIFFICULTIES, SONG_FIELDS, selectAll } from './catalog.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalog.json');

/** DB rows -> catalog.json entries: song fields (nulls dropped) plus a level per difficulty. */
export function toCatalog(songs, charts) {
  const levelsBySong = Map.groupBy(charts, (c) => c.song_id);
  return songs
    .toSorted((a, b) => (a.official_order ?? Infinity) - (b.official_order ?? Infinity)
      || a.title_jp.localeCompare(b.title_jp))
    .map((song) => {
      const entry = {};
      for (const field of SONG_FIELDS) {
        const value = song[field];
        if (value != null && !(Array.isArray(value) && !value.length)) entry[field] = value;
      }
      const levels = new Map((levelsBySong.get(song.id) ?? []).map((c) => [c.difficulty, c.level]));
      entry.levels = Object.fromEntries(DIFFICULTIES.map((d) => [d, levels.get(d) ?? null]));
      return entry;
    });
}

async function main() {
  const url = process.env.PUBLIC_SUPABASE_URL_HOLODORI;
  const key = process.env.PUBLIC_SUPABASE_ANON_KEY_HOLODORI;
  if (!url || !key) {
    console.error('Missing PUBLIC_SUPABASE_URL_HOLODORI or PUBLIC_SUPABASE_ANON_KEY_HOLODORI in the environment.');
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const catalog = toCatalog(
    await selectAll(supabase, 'songs', ['id', ...SONG_FIELDS].join(', ')),
    await selectAll(supabase, 'charts', 'id, song_id, difficulty, level'),
  );
  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n');
  const charts = catalog.flatMap((s) => Object.values(s.levels)).filter((l) => l != null).length;
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}: ${catalog.length} songs, ${charts} chart levels.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
