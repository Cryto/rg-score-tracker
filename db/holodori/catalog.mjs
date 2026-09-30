// Shared by the Holodori catalog scripts (export-catalog.mjs, import-catalog.mjs).

export const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD', 'EXPERT'];

// The `songs` columns catalog.json carries (everything but the id).
export const SONG_FIELDS = [
  'title_jp', 'title_en', 'artist_jp', 'artist_en',
  'lyrics_jp', 'lyrics_en', 'music_jp', 'music_en', 'arrangement_jp', 'arrangement_en',
  'category', 'official_order', 'jacket_asset_id', 'jacket_url', 'members',
];

/** Every row of a table (PostgREST caps a single response at 1000). */
export async function selectAll(supabase, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order('id').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
