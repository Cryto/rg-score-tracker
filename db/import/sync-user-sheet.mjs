// One-time sync from the user's manually-reviewed Google Sheet into the
// tracker database. This is the user's own reviewed data (not a scrape),
// used as the new source of truth for song titles/artists/levels/versions.
//
// Usage: node --env-file=.env db/import/sync-user-sheet.mjs db/import/infinitas_db_user.csv
//
// Version string handling:
//   "22 PENDUAL"              -> direct match against versions.name
//   "13 DistorteD CS / 17 SIRIUS" -> arcade debut is the part after "/"
//   "INFINITAS / 29 CastHour" -> arcade debut is the part after "/"
//   "13 DistorteD CS" (no /)  -> CS-only, no arcade debut -> left unmapped
//   "INFINITAS" / "ULTIMATE MOBILE" alone -> Infinitas/mobile-exclusive -> unmapped
//   "Unknown" / blank         -> unmapped
// Unmapped means debut_version_id is left as-is (not overwritten) for
// existing songs, and null for new songs.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const [, , csvPath] = process.argv;
if (!csvPath) {
  console.error('Usage: node --env-file=.env db/import/sync-user-sheet.mjs <path-to-csv>');
  process.exit(1);
}

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey);

function parseCsvLine(line) {
  const result = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { result.push(cur); cur = ''; }
      else cur += c;
    }
  }
  result.push(cur);
  return result;
}

// Loose match key: case, tilde-variant, and whitespace/quote differences
// between the sheet and our catalog are common (rendering artifacts, not
// different songs) - verified by spot-checking 57 near-duplicates before
// adopting this normalization.
function normTitle(t) {
  return t
    .toLowerCase()
    .replace(/[〜～]/g, '~')
    .replace(/[\s　]+/g, '')
    .replace(/['"]/g, '')
    .trim();
}

function parseLevelStr(s) {
  const out = {};
  const re = /([BNHAL])(\d+)/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = Number(m[2]);
  return out;
}

// Load versions and build a lookup: normalized name -> {id, number}
const { data: versionRows, error: versionsErr } = await supabase.from('versions').select('id, number, name');
if (versionsErr) { console.error('Failed to load versions:', versionsErr.message); process.exit(1); }
const versionByName = new Map(versionRows.map((v) => [v.name.toLowerCase(), v]));

const unmappedVersionStrings = new Map(); // raw string -> count
function resolveVersionId(raw) {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.toLowerCase() === 'unknown') return null;
  if (s.includes('/')) {
    s = s.slice(s.lastIndexOf('/') + 1).trim();
  } else if (/\bCS$/i.test(s)) {
    return null; // CS-only, never ported to arcade
  } else if (s.toLowerCase() === 'infinitas' || s.toLowerCase() === 'ultimate mobile') {
    return null; // exclusive to that platform, no arcade debut
  }
  const v = versionByName.get(s.toLowerCase());
  if (!v) {
    unmappedVersionStrings.set(raw, (unmappedVersionStrings.get(raw) ?? 0) + 1);
    return null;
  }
  return v.id;
}

// Parse and group CSV rows by title
const lines = readFileSync(csvPath, 'utf-8').trim().split(/\r?\n/);
const [, ...rows] = lines;
const songs = new Map(); // normTitle -> { title, artist, versionRaw, sp: {}, dp: {} }

for (const line of rows) {
  if (!line.trim()) continue;
  const [versionRaw, title, artist, style, levelStr] = parseCsvLine(line);
  if (!title) continue;
  const key = normTitle(title);
  if (!songs.has(key)) {
    songs.set(key, { title, artist, versionRaw, sp: {}, dp: {} });
  }
  const entry = songs.get(key);
  if (artist && !entry.artist) entry.artist = artist;
  if (versionRaw && !entry.versionRaw) entry.versionRaw = versionRaw;
  const levels = parseLevelStr(levelStr ?? '');
  if (style === 'SP') entry.sp = levels;
  else if (style === 'DP') entry.dp = levels;
}
console.log(`Parsed ${songs.size} distinct songs from ${rows.length} CSV rows.`);

// Load existing songs (paginated - Supabase caps a single select at 1000 rows)
let existingSongs = [];
{
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('songs')
      .select('id, title, artist, debut_version_id')
      .range(from, from + pageSize - 1);
    if (error) { console.error('Failed to load songs:', error.message); process.exit(1); }
    existingSongs = existingSongs.concat(data);
    if (data.length < pageSize) break;
  }
}
const existingByTitle = new Map(existingSongs.map((s) => [normTitle(s.title), s]));
console.log(`Loaded ${existingSongs.length} existing songs for matching.`);

const CHART_KEYS = ['B', 'N', 'H', 'A', 'L'];

let songsUpdated = 0, songsInserted = 0, chartsUpserted = 0, errors = 0;

for (const [key, entry] of songs) {
  const versionId = resolveVersionId(entry.versionRaw);
  let songId;
  const existing = existingByTitle.get(key);

  if (existing) {
    const patch = {};
    if (entry.artist && entry.artist !== existing.artist) patch.artist = entry.artist;
    if (versionId && versionId !== existing.debut_version_id) patch.debut_version_id = versionId;
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('songs').update(patch).eq('id', existing.id);
      if (error) { console.error(`Update failed for "${entry.title}": ${error.message}`); errors++; continue; }
    }
    songId = existing.id;
    songsUpdated++;
  } else {
    const { data: inserted, error } = await supabase
      .from('songs')
      .insert({ title: entry.title, artist: entry.artist || null, debut_version_id: versionId })
      .select('id')
      .single();
    if (error) { console.error(`Insert failed for "${entry.title}": ${error.message}`); errors++; continue; }
    songId = inserted.id;
    songsInserted++;
  }

  const charts = [];
  for (const diff of CHART_KEYS) {
    if (entry.sp[diff] > 0) charts.push({ song_id: songId, play_style: 'SP', difficulty: diff, level: entry.sp[diff] });
    if (entry.dp[diff] > 0) charts.push({ song_id: songId, play_style: 'DP', difficulty: diff, level: entry.dp[diff] });
  }
  if (charts.length === 0) continue;

  const { error: chartErr } = await supabase.from('charts').upsert(charts, { onConflict: 'song_id,play_style,difficulty' });
  if (chartErr) { console.error(`Chart upsert failed for "${entry.title}": ${chartErr.message}`); errors++; continue; }
  chartsUpserted += charts.length;
}

console.log('\n--- Summary ---');
console.log(`Songs updated: ${songsUpdated}`);
console.log(`Songs inserted: ${songsInserted}`);
console.log(`Charts upserted: ${chartsUpserted}`);
console.log(`Errors: ${errors}`);
console.log(`Unmapped version strings (${unmappedVersionStrings.size} distinct):`);
for (const [str, count] of [...unmappedVersionStrings.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}x  "${str}"`);
}

const { error: syncError } = await supabase.from('catalog_syncs').insert({});
if (syncError) console.error(`Failed to record catalog sync timestamp: ${syncError.message}`);
