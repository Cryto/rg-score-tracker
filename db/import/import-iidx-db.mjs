// One-time/rerunnable importer for the iidx-db song/chart catalog.
// Source: https://github.com/vanHavel/iidx-db (MIT license), data extracted
// from IIDX Infinitas via https://github.com/olji/Reflux.
//
// Usage:
//   1. Download the TSV (git-lfs tracked, so use the media host, not raw.githubusercontent.com):
//        curl -L -o songs.tsv https://media.githubusercontent.com/media/vanHavel/iidx-db/master/raw_data/songs.tsv
//   2. node --env-file=.env db/import/import-iidx-db.mjs songs.tsv
//
// Requires SUPABASE_SERVICE_ROLE_KEY and PUBLIC_SUPABASE_URL in .env (never commit that key).

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const [, , tsvPath] = process.argv;
if (!tsvPath) {
  console.error('Usage: node --env-file=.env db/import/import-iidx-db.mjs <path-to-songs.tsv>');
  process.exit(1);
}

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

// [playStyle, difficulty] for each of the 10 comma-separated level/notes slots.
const CHART_SLOTS = [
  ['SP', 'B'], ['SP', 'N'], ['SP', 'H'], ['SP', 'A'], ['SP', 'L'],
  ['DP', 'B'], ['DP', 'N'], ['DP', 'H'], ['DP', 'A'], ['DP', 'L'],
];

function parseBpm(raw) {
  const cleaned = raw.replace(/[~〜～-]/g, '~');
  const [min, max] = cleaned.split('~').map((n) => parseInt(n, 10));
  return { bpm_min: Number.isFinite(min) ? min : null, bpm_max: Number.isFinite(max) ? max : (Number.isFinite(min) ? min : null) };
}

// iidx-db's "folder" column: 0 = 1st style, 1 = substream (given number 0 in
// our versions table), 2-33 = matches the official version number directly.
// Anything outside that range (e.g. 80, an Infinitas-exclusive bucket) has no
// known mapping. See db/migrations/0002_seed_versions.sql for how this was verified.
function folderToVersionNumber(folder) {
  if (folder === 0) return 1;
  if (folder === 1) return 0;
  if (folder >= 2 && folder <= 33) return folder;
  return null;
}

const { data: versionRows, error: versionsError } = await supabase.from('versions').select('id, number');
if (versionsError) {
  console.error(`Failed to load versions: ${versionsError.message}`);
  process.exit(1);
}
const versionIdByNumber = new Map(versionRows.map((v) => [v.number, v.id]));
if (versionIdByNumber.size === 0) {
  console.error('No rows in versions table. Run db/migrations/0002_seed_versions.sql first.');
  process.exit(1);
}

const lines = readFileSync(tsvPath, 'utf-8').trim().split(/\r?\n/);
const [header, ...rows] = lines;
const cols = header.split('\t');
console.log(`Loaded ${rows.length} rows. Columns: ${cols.join(', ')}`);

let songCount = 0;
let chartCount = 0;
let errors = 0;
let unmappedVersions = 0;

for (const line of rows) {
  const [id, title, titleEnglish, artist, genre, levelCsv, notesCsv, folderRaw] = line.split('\t');
  const { bpm_min, bpm_max } = parseBpm(line.split('\t')[8] ?? '');
  const versionNumber = folderToVersionNumber(parseInt(folderRaw, 10));
  const debutVersionId = versionNumber === null ? null : (versionIdByNumber.get(versionNumber) ?? null);
  if (versionNumber !== null && debutVersionId === null) unmappedVersions++;

  const { data: song, error: songError } = await supabase
    .from('songs')
    .upsert(
      {
        external_id: id,
        title,
        title_english: titleEnglish,
        artist,
        genre,
        bpm_min,
        bpm_max,
        debut_version_id: debutVersionId,
      },
      { onConflict: 'external_id' }
    )
    .select('id')
    .single();

  if (songError) {
    console.error(`Failed to upsert song ${id} (${title}): ${songError.message}`);
    errors++;
    continue;
  }
  songCount++;

  const levels = levelCsv.split(',').map((n) => parseInt(n, 10));
  const notes = notesCsv.split(',').map((n) => parseInt(n, 10));

  const charts = CHART_SLOTS.map(([playStyle, difficulty], i) => ({
    song_id: song.id,
    play_style: playStyle,
    difficulty,
    level: levels[i],
    note_count: notes[i],
  })).filter((c) => c.level > 0);

  if (charts.length === 0) continue;

  const { error: chartError } = await supabase
    .from('charts')
    .upsert(charts, { onConflict: 'song_id,play_style,difficulty' });

  if (chartError) {
    console.error(`Failed to upsert charts for ${title}: ${chartError.message}`);
    errors++;
    continue;
  }
  chartCount += charts.length;
}

console.log(
  `Done. Songs upserted: ${songCount}, charts upserted: ${chartCount}, errors: ${errors}, unmapped versions table lookups: ${unmappedVersions}`
);
