// Loads every row of a table that's bigger than Supabase's 1000-row select
// cap. Shared by the game pages and db/iidx/fervidex/sync.mjs.
//
// Plain, type-only TypeScript: Node runs this file directly (type stripping),
// so keep it free of enums, namespaces and path-alias imports.
//
// Paging with .range() (OFFSET) makes Postgres rebuild every earlier page's
// rows (embeds included) just to skip them, and without an order the pages
// can overlap or miss rows. Instead the id span is split into one slice per
// ~1000 rows and the slices load in parallel, each paging by id within its
// slice (a dense slice just takes a second request).

import type { SupabaseClient } from '@supabase/supabase-js';

// Supabase's default max rows per request.
const PAGE = 1000;
// Slices loading at once; enough to overlap round trips without piling
// every request onto the database at the same moment.
const CONCURRENCY = 6;

/** Every row of `table` with `columns`, ordered by `idColumn` (an integer key). */
export async function selectAll(client: SupabaseClient, table: string, columns: string, idColumn = 'id'): Promise<any[]> {
  const [first, last, total] = await Promise.all([
    client.from(table).select(idColumn).order(idColumn, { ascending: true }).limit(1).maybeSingle(),
    client.from(table).select(idColumn).order(idColumn, { ascending: false }).limit(1).maybeSingle(),
    client.from(table).select(idColumn, { count: 'exact', head: true }),
  ]);
  const error = first.error ?? last.error ?? total.error;
  if (error) throw error;
  if (!first.data || !last.data) return [];
  const min: number = (first.data as any)[idColumn];
  const max: number = (last.data as any)[idColumn];

  const slices = Math.max(1, Math.ceil((total.count ?? PAGE) / PAGE));
  const span = Math.ceil((max - min + 1) / slices);
  const bounds = Array.from({ length: slices }, (_, i) => [min + i * span, Math.min(min + (i + 1) * span, max + 1)]);

  async function loadSlice([from, to]: number[]): Promise<any[]> {
    const rows: any[] = [];
    for (let next = from; next < to; ) {
      const { data, error } = await client.from(table).select(columns)
        .gte(idColumn, next).lt(idColumn, to).order(idColumn).limit(PAGE);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
      next = (data[data.length - 1] as any)[idColumn] + 1;
    }
    return rows;
  }

  const results: any[][] = new Array(bounds.length);
  let nextSlice = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, bounds.length) }, async () => {
    while (nextSlice < bounds.length) {
      const i = nextSlice++;
      results[i] = await loadSlice(bounds[i]);
    }
  }));
  return results.flat();
}
