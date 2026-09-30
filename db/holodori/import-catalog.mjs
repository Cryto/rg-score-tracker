// Loads the Holodori catalog (catalog.json, written from the original site's
// database by export-catalog.mjs) into a Supabase project, e.g. a fork's.
//
// Idempotent: songs match on title_jp, charts on (song_id, difficulty); only
// rows that actually differ are written. Songs no longer in catalog.json are
// left alone, never deleted, and scores are never touched.
//
// Fields also edited in the browser (title_en, artist_en, category,
// jacket_url, members, chart levels) are only filled in where the DB has
// none, so your own edits survive a re-import; where the DB and catalog.json
// disagree, the DB value is kept and counted. --force overwrites those with
// catalog.json's values instead. Other fields (credits, order, jacket asset)
// always follow catalog.json.
//
// Requires in .env (never commit the service-role key):
//   PUBLIC_SUPABASE_URL_HOLODORI, SUPABASE_SERVICE_ROLE_KEY_HOLODORI
// Usage: node --env-file=.env db/holodori/import-catalog.mjs [--dry-run] [--force] [--verbose]
//   --dry-run with the env vars set reads the DB and prints the plan; without
//   them it only counts catalog.json. --verbose lists each kept value.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { DIFFICULTIES, SONG_FIELDS, selectAll } from './catalog.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));

/** Song rows plus each song's charts, keyed by title_jp. */
export function buildCatalog(entries = JSON.parse(fs.readFileSync(path.join(DIR, 'catalog.json'), 'utf8'))) {
  const songs = entries.map(({ levels, ...song }) => song);
  const charts = new Map(entries.map((e) => [e.title_jp, DIFFICULTIES.map((difficulty) => ({
    difficulty, level: e.levels?.[difficulty] ?? null,
  }))]));
  return { songs, charts };
}

// Also edited in the browser: filled in where empty, never overwritten without --force.
const EDITABLE_FIELDS = ['title_en', 'artist_en', 'category', 'jacket_url', 'members'];

/**
 * Works out the writes needed to bring the DB in line with the catalog.
 * existingSongs: [{ id, title_jp, ...song columns }]; existingCharts: [{ song_id, difficulty, level }].
 * Returns { newSongs, songUpdates: [{ id, title_jp, patch }], chartInserts, chartUpdates, kept }
 * where new songs' charts are in newSongs[i].charts and kept lists DB values left in place.
 */
export function planImport({ songs, charts }, existingSongs, existingCharts, { force = false } = {}) {
  // JSON so members arrays compare by value.
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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
        if (value == null) continue; // catalog.json having nothing never clears a DB value
        if (existing[field] != null && !force) {
          plan.kept.push({ title: song.title_jp, field, db: existing[field], catalog: value });
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
          plan.kept.push({ title: song.title_jp, field: `${difficulty} level`, db: chart.level, catalog: level });
        } else {
          plan.chartUpdates.push({ song_id: existing.id, difficulty, level });
        }
      }
    }
  }
  return plan;
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

  const songColumns = ['id', ...SONG_FIELDS].join(', ');
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
    console.log(`Kept ${plan.kept.length} DB value(s) that differ from catalog.json (--force to overwrite):`);
    const byField = Map.groupBy(plan.kept, (k) => k.field);
    for (const [field, ks] of byField) console.log(`  ${field}: ${ks.length}`);
    if (process.argv.includes('--verbose')) {
      for (const k of plan.kept) console.log(`  ${k.title} ${k.field}: DB ${JSON.stringify(k.db)}, catalog.json ${JSON.stringify(k.catalog)}`);
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
