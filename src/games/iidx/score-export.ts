// Matching for native score-export files (scores.json, keyed by numeric song
// ID, e.g. fervidex's Score export). Shared by the /settings/iidx/import-json
// page and db/iidx/fervidex/sync.mjs, so both match charts the same way.
//
// Plain, type-only TypeScript: Node runs this file directly (type stripping),
// so keep it free of enums, namespaces and path-alias imports.

import type { SupabaseClient } from '@supabase/supabase-js';
import { CLEAR_LAMPS } from './grade.ts';

export type ParsedScore = {
  chart_id: number;
  ex_score: number | null;
  clear_lamp: string | null;
  miss_count: number | null;
};

export type ExportScore = { ex_score?: number; clear_type?: number; miss_count?: number };
export type UnmatchedChart = { code: string; score: ExportScore };

export type MatchResult = {
  matched: ParsedScore[];
  noPlayCount: number;
  // "<song id> <chart code>" for each chart with no catalog match.
  unmatched: string[];
  // Unmatched charts grouped by zero-padded external ID.
  unmatchedSongs: Map<string, UnmatchedChart[]>;
};

// "<external id>|<play style>|<difficulty>" -> chart id, over each song's main
// external_id and any extra IDs in song_external_ids.
export async function loadChartLookup(supabase: SupabaseClient): Promise<Map<string, number>> {
  // Supabase caps a single select at 1000 rows - page through until exhausted.
  const pageSize = 1000;
  let data: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase
      .from('charts')
      .select('id, song_id, play_style, difficulty, songs ( external_id )')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to load catalog: ${error.message}`);
    data = data.concat(page ?? []);
    if (!page || page.length < pageSize) break;
  }
  // Extra IDs a song is also known by (migration 0012). Before that
  // migration the table is missing; fall back to the main IDs alone.
  const { data: extra } = await supabase.from('song_external_ids').select('external_id, song_id');
  const idsBySong = new Map<number, string[]>();
  for (const e of extra ?? []) {
    if (!idsBySong.has(e.song_id)) idsBySong.set(e.song_id, []);
    idsBySong.get(e.song_id)!.push(e.external_id);
  }
  const lookup = new Map<string, number>();
  for (const c of data) {
    const ids = [c.songs?.external_id, ...(idsBySong.get(c.song_id) ?? [])].filter(Boolean);
    for (const id of ids) lookup.set(`${id}|${c.play_style}|${c.difficulty}`, c.id);
  }
  return lookup;
}

export function matchScores(fileContent: any, chartLookup: Map<string, number>): MatchResult {
  const byChart = new Map<number, ParsedScore>();
  const unmatched: string[] = [];
  const unmatchedSongs = new Map<string, UnmatchedChart[]>();
  let noPlayCount = 0;

  for (const [songId, chartMap] of Object.entries<any>(fileContent)) {
    if (songId === '__meta') continue;
    const externalId = songId.padStart(5, '0');

    for (const [chartCode, score] of Object.entries<any>(chartMap)) {
      const playStyle = chartCode.slice(0, 2).toUpperCase();
      const difficulty = chartCode.slice(2).toUpperCase();
      const chartId = chartLookup.get(`${externalId}|${playStyle}|${difficulty}`);

      if (score.clear_type === 0) {
        noPlayCount++;
        continue;
      }
      if (!chartId) {
        unmatched.push(`${songId} ${chartCode}`);
        if (!unmatchedSongs.has(externalId)) unmatchedSongs.set(externalId, []);
        unmatchedSongs.get(externalId)!.push({ code: chartCode.toUpperCase(), score });
        continue;
      }
      const parsed: ParsedScore = {
        chart_id: chartId,
        ex_score: score.ex_score ?? null,
        clear_lamp: score.clear_type ? CLEAR_LAMPS[score.clear_type - 1] : null,
        // -1 means no miss count was recorded (e.g. a failed play).
        miss_count: score.miss_count >= 0 ? score.miss_count : null,
      };
      // Two of a song's IDs in one file land on the same chart; keep the best
      // of each field, since one upsert can't write a row twice.
      const prev = byChart.get(chartId);
      if (prev) Object.assign(prev, best(prev, parsed));
      else byChart.set(chartId, parsed);
    }
  }
  return { matched: [...byChart.values()], noPlayCount, unmatched, unmatchedSongs };
}

function best(a: ParsedScore, b: ParsedScore): ParsedScore {
  const max = (x: number | null, y: number | null) => (x == null ? y : y == null ? x : Math.max(x, y));
  const min = (x: number | null, y: number | null) => (x == null ? y : y == null ? x : Math.min(x, y));
  const lampRank = (l: string | null) => (l ? CLEAR_LAMPS.indexOf(l as any) : -1);
  return {
    chart_id: a.chart_id,
    ex_score: max(a.ex_score, b.ex_score),
    clear_lamp: lampRank(b.clear_lamp) > lampRank(a.clear_lamp) ? b.clear_lamp : a.clear_lamp,
    miss_count: min(a.miss_count, b.miss_count),
  };
}
