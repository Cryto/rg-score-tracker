// Rerunnable importer for the IIDX catalog from the "Infinitas DB" Google
// Sheet (tab Master), which is the catalog's source of truth. Replaces
// import-iidx-db.mjs.
//
// The sheet has one row per song and play style (SP/DP). Its "Supabase ID"
// column holds songs.id; a blank ID means a new song, which is inserted and
// its new id written to an output CSV so it can be pasted back into the sheet.
// Charts keep their ids: they're matched on (song, style, difficulty).
//
// Usage:
//   1. Run db/iidx/migrations/0010_sheet_catalog.sql once.
//   2. In the sheet, File > Download > Comma-separated values (Master tab).
//   3. node --env-file=.env db/iidx/import/import-sheet.mjs master.csv --dry-run
//      Prints what would change and writes nothing. Drop --dry-run to apply.
//
// Options:
//   --dry-run         Report only.
//   --delete-missing  Also delete songs and charts that aren't in the sheet.
//                     Their scores are deleted with them (the report counts them).
//   --out <path>      Where to write the new song ids (default new-song-ids.csv).
//
// Requires SUPABASE_SERVICE_ROLE_KEY and PUBLIC_SUPABASE_URL in .env (never commit that key).

import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const deleteMissing = args.includes('--delete-missing');
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : 'new-song-ids.csv';
const csvPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
if (!csvPath) {
  console.error('Usage: node --env-file=.env db/iidx/import/import-sheet.mjs <master.csv> [--dry-run] [--delete-missing] [--out new-song-ids.csv]');
  process.exit(1);
}

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey);

// ---- Sheet parsing -------------------------------------------------------

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Sheet header -> songs column. Every other header that isn't a chart,
// version or ID column lands in songs.extra.
const SONG_COLUMNS = {
  'Song Title': 'title',
  'Romanji': 'title_english',
  'Artist': 'artist',
  'Genre': 'genre',
  'Composition': 'composition',
  'Arrangement': 'arrangement',
  'Production': 'production',
  'Lyrics': 'lyrics',
  'Vocals': 'vocals',
  'BPM': 'bpm_text',
  'Length': 'length_text',
  'Link': 'remywiki_url',
};
// BA is Black Another: stored as difficulty L with chart_label "Black Another".
const CHART_COLUMNS = ['B', 'N', 'H', 'A', 'L', 'BA'];
const HANDLED = new Set([
  ...Object.keys(SONG_COLUMNS),
  ...CHART_COLUMNS.flatMap((d) => [`${d} Level`, `${d} Notes`]),
  'Style', 'Release Version', 'Playable In', 'Notes', 'Supabase ID',
  // Looked up in the sheet from songs.external_id and song_external_ids, so
  // the database already holds them.
  'INFINITAS ID', 'AC ID',
]);

const [header, ...body] = parseCsv(readFileSync(csvPath, 'utf-8').replace(/^﻿/, ''));
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
for (const required of ['Song Title', 'Style', 'Supabase ID']) {
  if (!(required in col)) {
    console.error(`The CSV has no "${required}" column. Is this the Master tab?`);
    process.exit(1);
  }
}
const extraHeaders = header.map((h) => h.trim()).filter((h) => h && !HANDLED.has(h));

const problems = [];
const cell = (r, name) => (name in col ? (r[col[name]] ?? '').trim() : '');

function parseBpm(text) {
  const nums = (text.match(/\d+(\.\d+)?/g) ?? []).map(Number).map(Math.round);
  if (!nums.length) return { bpm_min: null, bpm_max: null };
  return { bpm_min: Math.min(...nums), bpm_max: Math.max(...nums) };
}

// Many cells list several lengths ("2:02 (beatmania IIDX), 1:54 (DanceDanceRevolution)");
// the first one is used.
function parseLength(text) {
  const m = text.match(/^(\d+):(\d{2})\b/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// One entry per song: its SP and DP rows, keyed by Supabase ID, or for new
// songs by title + artist + link (case-sensitive: SWITCH and switch differ).
const songs = new Map();
body.forEach((r, i) => {
  const rowNumber = i + 2;
  if (!r.some((v) => v.trim())) return;
  const title = cell(r, 'Song Title');
  const style = cell(r, 'Style');
  const idText = cell(r, 'Supabase ID');
  if (!title) { problems.push(`Row ${rowNumber}: no Song Title`); return; }
  if (style !== 'SP' && style !== 'DP') { problems.push(`Row ${rowNumber} (${title}): Style is "${style}", not SP or DP`); return; }
  if (idText && !/^\d+$/.test(idText)) { problems.push(`Row ${rowNumber} (${title}): Supabase ID "${idText}" isn't a number`); return; }
  const key = idText ? `id:${idText}` : `new:${title}\u0000${cell(r, 'Artist')}\u0000${cell(r, 'Link')}`;
  if (!songs.has(key)) songs.set(key, { id: idText ? Number(idText) : null, rows: [] });
  const song = songs.get(key);
  if (song.rows.some((x) => x.style === style)) {
    problems.push(`Row ${rowNumber} (${title}): a second ${style} row for the same song`);
    return;
  }
  song.rows.push({ rowNumber, style, r });
});

// Song fields come from the SP row (DP if there's no SP row). Rows that
// disagree are reported; Notes is the one field allowed to differ.
for (const song of songs.values()) {
  song.rows.sort((a, b) => a.style.localeCompare(b.style)).reverse(); // SP first
  const [first] = song.rows;
  const fields = {};
  for (const [h, field] of Object.entries(SONG_COLUMNS)) fields[field] = cell(first.r, h) || null;
  for (const other of song.rows.slice(1)) {
    for (const [h, field] of Object.entries(SONG_COLUMNS)) {
      if ((cell(other.r, h) || null) !== fields[field]) {
        problems.push(`Rows ${first.rowNumber}/${other.rowNumber} (${fields.title}): ${h} differs between SP and DP; using ${first.style}`);
      }
    }
    for (const h of ['Release Version', 'Playable In']) {
      if (cell(other.r, h) !== cell(first.r, h)) {
        problems.push(`Rows ${first.rowNumber}/${other.rowNumber} (${fields.title}): ${h} differs between SP and DP; using ${first.style}`);
      }
    }
  }
  const notes = song.rows.map((x) => [x.style, cell(x.r, 'Notes')]);
  const distinctNotes = new Set(notes.map(([, n]) => n));
  fields.notes = distinctNotes.size <= 1
    ? (notes[0][1] || null)
    : notes.filter(([, n]) => n).map(([s, n]) => `${s}: ${n}`).join(' / ') || null;
  Object.assign(fields, parseBpm(fields.bpm_text ?? ''));
  fields.length_seconds = fields.length_text ? parseLength(fields.length_text) : null;
  if (fields.length_text && fields.length_seconds === null) {
    problems.push(`Row ${first.rowNumber} (${fields.title}): Length "${fields.length_text}" doesn't start with m:ss`);
  }
  fields.extra = Object.fromEntries(extraHeaders.map((h) => [h, cell(first.r, h)]).filter(([, v]) => v));
  song.fields = fields;
  song.releaseVersion = cell(first.r, 'Release Version');
  song.playableIn = cell(first.r, 'Playable In').split(' - ').map((s) => s.trim()).filter(Boolean);

  song.charts = [];
  for (const { rowNumber, style, r } of song.rows) {
    for (const d of CHART_COLUMNS) {
      const levelText = cell(r, `${d} Level`);
      const notesText = cell(r, `${d} Notes`);
      if (!levelText) {
        if (notesText) problems.push(`Row ${rowNumber} (${fields.title}): ${d} Notes without a ${d} Level; skipped`);
        continue;
      }
      const level = Number(levelText);
      if (!Number.isInteger(level) || level < 1 || level > 12) {
        problems.push(`Row ${rowNumber} (${fields.title}): ${d} Level "${levelText}" isn't 1-12; skipped`);
        continue;
      }
      const noteCount = notesText === '' ? null : Number(notesText.replace(/,/g, ''));
      if (noteCount !== null && !Number.isInteger(noteCount)) {
        problems.push(`Row ${rowNumber} (${fields.title}): ${d} Notes "${notesText}" isn't a number; left blank`);
      }
      const difficulty = d === 'BA' ? 'L' : d;
      if (song.charts.some((c) => c.play_style === style && c.difficulty === difficulty)) {
        problems.push(`Row ${rowNumber} (${fields.title}): has both L and BA; kept L, skipped BA`);
        continue;
      }
      song.charts.push({
        play_style: style,
        difficulty,
        level,
        note_count: Number.isInteger(noteCount) ? noteCount : null,
        chart_label: d === 'BA' ? 'Black Another' : null,
      });
    }
  }
}

// ---- Current database ----------------------------------------------------

async function selectAll(table, columns, orderBy = 'id') {
  const pageSize = 1000;
  let out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).order(orderBy).range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to load ${table}: ${error.message}`);
    out = out.concat(data);
    if (data.length < pageSize) return out;
  }
}

const versions = await selectAll('versions', 'id, number, name, sheet_name, platform');
if (!versions.some((v) => v.sheet_name)) {
  console.error('versions.sheet_name is empty. Run db/iidx/migrations/0010_sheet_catalog.sql first.');
  process.exit(1);
}
const versionBySheetName = new Map(versions.filter((v) => v.sheet_name).map((v) => [v.sheet_name, v.id]));
const versionById = new Map(versions.map((v) => [v.id, v]));
// A song's Version is its first arcade release, then INFINITAS, then CS, then
// ULTIMATE MOBILE. The sheet writes older songs' Release Version as their CS
// release ("4th CS"), so the earliest arcade version in Playable In wins over
// it; an arcade Release Version is kept as written (ZINRAI's preview songs
// were playable in Sparkle Shower first but belong to ZINRAI).
const PLATFORM_ORDER = ['arcade', 'infinitas', 'cs', 'mobile'];
const versionPriority = (id) => {
  const v = versionById.get(id);
  const rank = PLATFORM_ORDER.indexOf(v.platform);
  // substream (number 0) came out between 1st and 2nd style.
  return (rank < 0 ? PLATFORM_ORDER.length : rank) * 1000 + (v.number === 0 ? 1.5 : v.number);
};
const SONG_FIELDS = [...new Set([...Object.values(SONG_COLUMNS), 'notes', 'bpm_min', 'bpm_max', 'length_seconds', 'extra', 'debut_version_id'])];
const dbSongs = await selectAll('songs', `id, ${SONG_FIELDS.join(', ')}`);
const dbSongById = new Map(dbSongs.map((s) => [s.id, s]));
const dbCharts = await selectAll('charts', 'id, song_id, play_style, difficulty, level, note_count, chart_label');
const chartKey = (c) => `${c.song_id}|${c.play_style}|${c.difficulty}`;
const dbChartByKey = new Map(dbCharts.map((c) => [chartKey(c), c]));
const scoredChartIds = new Set((await selectAll('scores', 'chart_id', 'chart_id')).map((s) => s.chart_id));

const unknownVersions = new Map();
const versionId = (name, song) => {
  if (!name) return null;
  const id = versionBySheetName.get(name);
  if (id === undefined) unknownVersions.set(name, [...(unknownVersions.get(name) ?? []), song.fields.title]);
  return id ?? null;
};
for (const song of songs.values()) {
  const releaseId = versionId(song.releaseVersion, song);
  song.availability = [...new Set([...song.playableIn.map((v) => versionId(v, song)), releaseId].filter((id) => id !== null))];
  song.fields.debut_version_id = releaseId !== null && versionById.get(releaseId).platform === 'arcade'
    ? releaseId
    : [...song.availability].sort((a, b) => versionPriority(a) - versionPriority(b))[0] ?? null;
  if (song.id !== null && !dbSongById.has(song.id)) {
    problems.push(`Supabase ID ${song.id} (${song.fields.title}) isn't in the database; it will be inserted with that id`);
  }
}

// ---- Plan ----------------------------------------------------------------

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fieldChanges = new Map();
let songsToUpdate = 0;
const sheetSongIds = new Set([...songs.values()].map((s) => s.id).filter((id) => id !== null));
for (const song of songs.values()) {
  const existing = song.id !== null ? dbSongById.get(song.id) : null;
  if (!existing) continue;
  const changed = SONG_FIELDS.filter((f) => !same(song.fields[f], existing[f]));
  if (changed.length) songsToUpdate++;
  for (const f of changed) fieldChanges.set(f, (fieldChanges.get(f) ?? 0) + 1);
}
const newSongs = [...songs.values()].filter((s) => s.id === null || !dbSongById.has(s.id));

const sheetChartKeys = new Set();
let chartsToInsert = 0;
let chartsToUpdate = 0;
for (const song of songs.values()) {
  if (song.id === null) { chartsToInsert += song.charts.length; continue; }
  for (const c of song.charts) {
    const key = chartKey({ song_id: song.id, ...c });
    sheetChartKeys.add(key);
    const existing = dbChartByKey.get(key);
    if (!existing) chartsToInsert++;
    else if (['level', 'note_count', 'chart_label'].some((f) => !same(c[f], existing[f]))) chartsToUpdate++;
  }
}
const songsMissing = dbSongs.filter((s) => !sheetSongIds.has(s.id));
const missingSongIds = new Set(songsMissing.map((s) => s.id));
const chartsMissing = dbCharts.filter((c) => !sheetChartKeys.has(chartKey(c)) && !missingSongIds.has(c.song_id));
const scoredIn = (charts) => charts.filter((c) => scoredChartIds.has(c.id)).length;
const chartsOfMissingSongs = dbCharts.filter((c) => missingSongIds.has(c.song_id));

console.log(`Sheet: ${body.length} rows, ${songs.size} songs, ${[...songs.values()].reduce((n, s) => n + s.charts.length, 0)} charts.`);
console.log(`Database: ${dbSongs.length} songs, ${dbCharts.length} charts, ${scoredChartIds.size} scored charts.`);
console.log('');
console.log(`Songs to update: ${songsToUpdate}${fieldChanges.size ? ` (${[...fieldChanges].map(([f, n]) => `${f} ${n}`).join(', ')})` : ''}`);
console.log(`Songs to insert: ${newSongs.length}`);
console.log(`Charts to update: ${chartsToUpdate}`);
console.log(`Charts to insert: ${chartsToInsert}`);
console.log(`Songs in the database but not the sheet: ${songsMissing.length} (${scoredIn(chartsOfMissingSongs)} scored charts)`);
for (const s of songsMissing) console.log(`  ${s.id}  ${s.title}`);
console.log(`Charts in the database but not the sheet (on songs that are): ${chartsMissing.length} (${scoredIn(chartsMissing)} scored)`);
for (const c of chartsMissing) {
  console.log(`  chart ${c.id}  ${dbSongById.get(c.song_id)?.title} ${c.play_style} ${c.difficulty}${scoredChartIds.has(c.id) ? '  (has a score)' : ''}`);
}
console.log(deleteMissing ? 'These will be deleted (--delete-missing), with their scores.' : 'These are left alone. Pass --delete-missing to delete them.');
if (extraHeaders.length) console.log(`Columns stored in songs.extra: ${extraHeaders.join(', ')}`);
if (unknownVersions.size) {
  console.log('Version names with no versions.sheet_name match (ignored):');
  for (const [name, titles] of unknownVersions) console.log(`  "${name}" on ${titles.length} song(s), e.g. ${titles[0]}`);
}
if (problems.length) {
  console.log(`Problems (${problems.length}):`);
  for (const p of problems) console.log(`  ${p}`);
}

if (dryRun) {
  console.log('\nDry run: nothing was written.');
  process.exit(0);
}

// ---- Apply ---------------------------------------------------------------

let errors = 0;
const fail = (what, error) => { errors++; console.error(`${what}: ${error.message}`); };
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

// Existing songs (and sheet IDs missing from the database) keep their id.
const keepId = [...songs.values()].filter((s) => s.id !== null);
for (const batch of chunks(keepId, 200)) {
  const { error } = await supabase.from('songs').upsert(batch.map((s) => ({ id: s.id, ...s.fields })), { onConflict: 'id' });
  if (error) fail('Failed to upsert songs', error);
}

// New songs one at a time, so each new id maps back to its sheet rows.
const newIdRows = [['row', 'style', 'title', 'supabase_id']];
for (const song of songs.values()) {
  if (song.id !== null) continue;
  const { data, error } = await supabase.from('songs').insert(song.fields).select('id').single();
  if (error) { fail(`Failed to insert ${song.fields.title}`, error); continue; }
  song.id = data.id;
  for (const x of song.rows) newIdRows.push([x.rowNumber, x.style, song.fields.title, data.id]);
}
const csvField = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync(outPath, newIdRows.map((r) => r.map(csvField).join(',')).join('\n') + '\n');
console.log(`Wrote ${newIdRows.length - 1} new-song rows to ${outPath}`);

const charts = [...songs.values()].filter((s) => s.id !== null).flatMap((s) => s.charts.map((c) => ({ song_id: s.id, ...c })));
for (const batch of chunks(charts, 500)) {
  const { error } = await supabase.from('charts').upsert(batch, { onConflict: 'song_id,play_style,difficulty' });
  if (error) fail('Failed to upsert charts', error);
}

if (deleteMissing) {
  for (const batch of chunks(chartsMissing.map((c) => c.id), 200)) {
    const { error } = await supabase.from('charts').delete().in('id', batch);
    if (error) fail('Failed to delete charts', error);
  }
  for (const batch of chunks([...missingSongIds], 200)) {
    const { error } = await supabase.from('songs').delete().in('id', batch);
    if (error) fail('Failed to delete songs', error);
  }
}

// Playable In applies to every chart of the song. Rebuilt from scratch for
// the sheet's songs.
const chartIdByKey = new Map((await selectAll('charts', 'id, song_id, play_style, difficulty')).map((c) => [chartKey(c), c.id]));
const availability = [];
const sheetChartIds = [];
for (const song of songs.values()) {
  if (song.id === null) continue;
  for (const c of song.charts) {
    const id = chartIdByKey.get(chartKey({ song_id: song.id, ...c }));
    if (id === undefined) continue;
    sheetChartIds.push(id);
    for (const version_id of song.availability) availability.push({ chart_id: id, version_id });
  }
}
for (const batch of chunks(sheetChartIds, 200)) {
  const { error } = await supabase.from('chart_availability').delete().in('chart_id', batch);
  if (error) fail('Failed to clear chart_availability', error);
}
for (const batch of chunks(availability, 1000)) {
  const { error } = await supabase.from('chart_availability').insert(batch);
  if (error) fail('Failed to insert chart_availability', error);
}

const { error: syncError } = await supabase.from('catalog_syncs').insert({ source: 'sheet' });
if (syncError) fail('Failed to record catalog sync timestamp', syncError);

console.log(`Done. ${songs.size} songs, ${charts.length} charts, ${availability.length} availability rows, errors: ${errors}`);
process.exit(errors ? 1 : 0);
