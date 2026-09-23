// Loads the Holodori catalog into its Supabase project: songs.json (official
// song list) + levels.csv (per-chart levels, incl. sheet-only songs).
//
// Idempotent: songs match on title_jp, charts on (song_id, difficulty); only
// rows that actually differ are written. Songs no longer in the source files
// are left alone, never deleted, and `members` is never touched.
//
// Fields also edited outside these files (title_en, artist_en, jacket_url,
// chart levels) are only filled in where the DB has none, so those edits
// survive a re-import; where the DB and the files disagree, the DB value is
// kept and counted. --force overwrites those with the files' values instead.
// Other official-site fields (credits, category, order) always follow the
// files. TITLE_RENAMES maps source titles to songs renamed in the DB, since
// title_jp is the identity a re-import matches on.
//
// Requires in .env (never commit the service-role key):
//   PUBLIC_SUPABASE_URL_HOLODORI, SUPABASE_SERVICE_ROLE_KEY_HOLODORI
// Usage: node --env-file=.env db/holodori/import-catalog.mjs [--dry-run] [--force] [--verbose]
//   --dry-run with the env vars set reads the DB and prints the plan; without
//   them it only counts the source files. --verbose lists each kept value.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { parseCsv } from './csv.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD', 'EXPERT'];
// Source title -> the title_jp the song has in the DB.
const TITLE_RENAMES = {
  '地獄で会おうぜ！ スバちょこるなたん': '地獄であおうぜ！スバちょこるなたん',
};
const renamed = (title) => TITLE_RENAMES[title] ?? title;

/** Song rows plus each song's charts, keyed by title_jp. */
export function buildCatalog() {
  const official = JSON.parse(fs.readFileSync(path.join(DIR, 'songs.json'), 'utf8'));
  const [header, ...rows] = parseCsv(fs.readFileSync(path.join(DIR, 'levels.csv'), 'utf8').trimStart() /* also strips the BOM */)
    .filter((r) => r.some((f) => f.trim()));
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const levelsByTitle = new Map(rows.map((r) => [renamed(r[col.title_jp]), DIFFICULTIES.map((d) => r[col[d.toLowerCase()]]?.trim() || null)]));

  const songs = official.map((s) => ({
    title_jp: renamed(s.title_jp), title_en: s.title_en,
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

// Also edited outside the source files: filled in where empty, never overwritten without --force.
const EDITABLE_FIELDS = ['title_en', 'artist_en', 'jacket_url'];

/**
 * Works out the writes needed to bring the DB in line with the catalog.
 * existingSongs: [{ id, title_jp, ...song columns }]; existingCharts: [{ song_id, difficulty, level }].
 * Returns { newSongs, songUpdates: [{ id, title_jp, patch }], chartInserts, chartUpdates, kept }
 * where new songs' charts are in newSongs[i].charts and kept lists DB values left in place.
 */
export function planImport({ songs, charts }, existingSongs, existingCharts, { force = false } = {}) {
  const same = (a, b) => (a ?? null) === (b ?? null);
  const songByTitle = new Map(existingSongs.map((s) => [s.title_jp, s]));
  const chartByKey = new Map(existingCharts.map((c) => [`${c.song_id}:${c.difficulty}`, c]));
  const plan = { newSongs: [], songUpdates: [], chartInserts: [], chartUpdates: [], kept: [] };

  for (const song of songs) {
    const existing = songByTitle.get(song.title_jp);
    if (!existing) {
      plan.newSongs.push({ song, charts: charts.get(song.title_jp) });
      continue;
    }
    const patch = {};
    for (const [field, value] of Object.entries(song)) {
      if (field === 'title_jp' || same(existing[field], value)) continue;
      if (EDITABLE_FIELDS.includes(field)) {
        if (value == null) continue; // the files having nothing never clears a DB value
        if (existing[field] != null && !force) {
          plan.kept.push({ title: song.title_jp, field, db: existing[field], file: value });
          continue;
        }
      }
      patch[field] = value;
    }
    if (Object.keys(patch).length) plan.songUpdates.push({ id: existing.id, title_jp: song.title_jp, patch });

    for (const { difficulty, level } of charts.get(song.title_jp)) {
      const chart = chartByKey.get(`${existing.id}:${difficulty}`);
      if (!chart) {
        plan.chartInserts.push({ song_id: existing.id, difficulty, level });
      } else if (level != null && !same(chart.level, level)) {
        if (chart.level != null && !force) {
          plan.kept.push({ title: song.title_jp, field: `${difficulty} level`, db: chart.level, file: level });
        } else {
          plan.chartUpdates.push({ song_id: existing.id, difficulty, level });
        }
      }
    }
  }
  return plan;
}

/** Every row of a table (PostgREST caps a single response at 1000). */
async function selectAll(supabase, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order('id').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const catalog = buildCatalog();
  const { songs, charts } = catalog;
  const chartCount = [...charts.values()].flat().length;
  console.log(`Catalog: ${songs.length} songs (${songs.filter((s) => s.official_order).length} official), ${chartCount} charts.`);

  const url = process.env.PUBLIC_SUPABASE_URL_HOLODORI;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY_HOLODORI;
  if (!url || !key) {
    if (dryRun) return;
    console.error('Missing PUBLIC_SUPABASE_URL_HOLODORI or SUPABASE_SERVICE_ROLE_KEY_HOLODORI in the environment.');
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const songColumns = ['id', ...new Set(songs.flatMap(Object.keys))].join(', ');
  const plan = planImport(
    catalog,
    await selectAll(supabase, 'songs', songColumns),
    await selectAll(supabase, 'charts', 'id, song_id, difficulty, level'),
    { force },
  );

  console.log(`Plan: ${plan.newSongs.length} new songs, ${plan.songUpdates.length} song updates, ` +
    `${plan.chartInserts.length} new charts, ${plan.chartUpdates.length} level updates.`);
  for (const { title_jp, patch } of plan.songUpdates) console.log(`  update ${title_jp}: ${Object.keys(patch).join(', ')}`);
  for (const { song_id, difficulty, level } of plan.chartUpdates) console.log(`  level song ${song_id} ${difficulty} -> ${level}`);
  if (plan.kept.length) {
    console.log(`Kept ${plan.kept.length} DB value(s) that differ from the files (--force to overwrite):`);
    const byField = Map.groupBy(plan.kept, (k) => k.field);
    for (const [field, ks] of byField) console.log(`  ${field}: ${ks.length}`);
    if (process.argv.includes('--verbose')) {
      for (const k of plan.kept) console.log(`  ${k.title} ${k.field}: DB ${JSON.stringify(k.db)}, files ${JSON.stringify(k.file)}`);
    }
  }
  if (dryRun) return;

  let chartInserts = plan.chartInserts;
  if (plan.newSongs.length) {
    const { data, error } = await supabase.from('songs').insert(plan.newSongs.map((n) => n.song)).select('id, title_jp');
    if (error) throw new Error(`songs: ${error.message}`);
    const idByTitle = new Map(data.map((s) => [s.title_jp, s.id]));
    chartInserts = chartInserts.concat(plan.newSongs.flatMap((n) => n.charts.map((c) => ({ song_id: idByTitle.get(n.song.title_jp), ...c }))));
  }
  for (const { id, title_jp, patch } of plan.songUpdates) {
    const { error } = await supabase.from('songs').update(patch).eq('id', id);
    if (error) throw new Error(`song ${title_jp}: ${error.message}`);
  }
  if (chartInserts.length) {
    const { error } = await supabase.from('charts').insert(chartInserts);
    if (error) throw new Error(`charts: ${error.message}`);
  }
  for (const { song_id, difficulty, level } of plan.chartUpdates) {
    const { error } = await supabase.from('charts').update({ level }).eq('song_id', song_id).eq('difficulty', difficulty);
    if (error) throw new Error(`chart ${song_id} ${difficulty}: ${error.message}`);
  }

  const wrote = plan.newSongs.length + plan.songUpdates.length + chartInserts.length + plan.chartUpdates.length;
  if (!wrote) return console.log('Nothing to write; the DB already matches.');
  const { error: syncErr } = await supabase.from('catalog_syncs').insert({});
  if (syncErr) console.warn(`Note: failed to record catalog sync timestamp: ${syncErr.message}`);
  console.log('Done.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
