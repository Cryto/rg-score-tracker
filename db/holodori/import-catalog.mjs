// Loads the Holodori catalog into its Supabase project: songs.json (official
// song list) + levels.csv (per-chart levels, incl. sheet-only songs).
//
// Idempotent: songs upsert on title_jp, charts on (song_id, difficulty), so
// re-running after regenerating songs.json / levels.csv updates rows in place.
// Songs no longer in the source files are left alone, never deleted.
//
// Requires in .env (never commit the service-role key):
//   PUBLIC_SUPABASE_URL_HOLODORI, SUPABASE_SERVICE_ROLE_KEY_HOLODORI
// Usage: node --env-file=.env db/holodori/import-catalog.mjs [--dry-run]
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { parseCsv } from './csv.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD', 'EXPERT'];

/** Song rows plus each song's charts, keyed by title_jp. */
export function buildCatalog() {
  const official = JSON.parse(fs.readFileSync(path.join(DIR, 'songs.json'), 'utf8'));
  const [header, ...rows] = parseCsv(fs.readFileSync(path.join(DIR, 'levels.csv'), 'utf8').trimStart() /* also strips the BOM */)
    .filter((r) => r.some((f) => f.trim()));
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const levelsByTitle = new Map(rows.map((r) => [r[col.title_jp], DIFFICULTIES.map((d) => r[col[d.toLowerCase()]]?.trim() || null)]));

  const songs = official.map((s) => ({
    title_jp: s.title_jp, title_en: s.title_en,
    artist_jp: s.artist_jp, artist_en: s.artist_en,
    lyrics_jp: s.lyrics_jp, lyrics_en: s.lyrics_en,
    music_jp: s.music_jp, music_en: s.music_en,
    arrangement_jp: s.arrangement_jp, arrangement_en: s.arrangement_en,
    category: s.category, official_order: s.order,
    jacket_asset_id: s.jacket_asset_id, jacket_url: s.jacket_url,
  }));
  // Songs only in the level sheet (not on the official music page): title only.
  const officialTitles = new Set(songs.map((s) => s.title_jp));
  for (const title of levelsByTitle.keys()) {
    if (!officialTitles.has(title)) songs.push({ title_jp: title });
  }

  const charts = new Map(songs.map((s) => [s.title_jp, DIFFICULTIES.map((difficulty, i) => {
    const level = levelsByTitle.get(s.title_jp)?.[i];
    return { difficulty, level: level == null ? null : Number(level) };
  })]));
  return { songs, charts };
}

async function main() {
  const { songs, charts } = buildCatalog();
  const chartCount = [...charts.values()].flat().length;
  console.log(`Catalog: ${songs.length} songs (${songs.filter((s) => s.official_order).length} official), ${chartCount} charts.`);
  if (process.argv.includes('--dry-run')) return;

  const url = process.env.PUBLIC_SUPABASE_URL_HOLODORI;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY_HOLODORI;
  if (!url || !key) {
    console.error('Missing PUBLIC_SUPABASE_URL_HOLODORI or SUPABASE_SERVICE_ROLE_KEY_HOLODORI in the environment.');
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: written, error: songErr } = await supabase
    .from('songs').upsert(songs, { onConflict: 'title_jp' }).select('id, title_jp');
  if (songErr) throw new Error(`songs: ${songErr.message}`);
  const idByTitle = new Map(written.map((s) => [s.title_jp, s.id]));

  const chartRows = [...charts].flatMap(([title, cs]) => cs.map((c) => ({ song_id: idByTitle.get(title), ...c })));
  const { error: chartErr } = await supabase.from('charts').upsert(chartRows, { onConflict: 'song_id,difficulty' });
  if (chartErr) throw new Error(`charts: ${chartErr.message}`);

  const { error: syncErr } = await supabase.from('catalog_syncs').insert({});
  if (syncErr) console.warn(`Note: failed to record catalog sync timestamp: ${syncErr.message}`);
  console.log(`Wrote ${written.length} songs and ${chartRows.length} charts.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
