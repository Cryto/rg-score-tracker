// Per-chart score history from `score_attempts` (every submission as sent,
// before ratcheting), shared by the IIDX and Holodori pages. Attempts are
// fetched on demand when a chart is opened, not with the song list.
import type { SupabaseClient } from '@supabase/supabase-js';

export type HistoryEntry = {
  at: string;
  score: number | null;
  /** Trusted HTML shown after the score (lamp, BP, badges); the caller escapes it. */
  extraHtml: string;
};

const cache = new Map<string, Promise<any[]>>();

/** A chart's attempts, oldest first. Cached per client + chart for the page's lifetime. */
export function loadAttempts(client: SupabaseClient, key: string, chartId: number, columns: string): Promise<any[]> {
  const cacheKey = `${key}:${chartId}`;
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, (async () => {
      const { data, error } = await client
        .from('score_attempts')
        .select(`submitted_at, ${columns}`)
        .eq('chart_id', chartId)
        .order('submitted_at')
        .order('id');
      if (error) {
        cache.delete(cacheKey);
        throw error;
      }
      return data ?? [];
    })());
  }
  return cache.get(cacheKey)!;
}

function sparkline(values: number[]): string {
  const w = 160, h = 32, pad = 3;
  const min = Math.min(...values), max = Math.max(...values);
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (values.length - 1);
  const y = (v: number) => (max === min ? h / 2 : h - pad - ((v - min) * (h - 2 * pad)) / (max - min));
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  return `<svg class="history-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <polyline points="${points.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
    ${points.map((p) => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="2" fill="currentColor" />`).join('')}
  </svg>`;
}

/**
 * History panel body: a sparkline once there are two scored attempts, then
 * the attempts newest first. An attempt that beat every earlier score is
 * tagged PB.
 */
export function historyHtml(entries: HistoryEntry[], formatScore: (n: number) => string = (n) => n.toLocaleString('en-US')): string {
  if (!entries.length) return '<p class="history-empty">No attempts logged yet.</p>';
  let best = -Infinity;
  const rows = entries.map((e) => {
    const pb = e.score != null && e.score > best;
    if (e.score != null && e.score > best) best = e.score;
    const when = new Date(e.at).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return `<li><span class="history-when">${when}</span><span class="history-score">${e.score != null ? formatScore(e.score) : '—'}</span>${pb ? '<span class="history-pb">PB</span>' : ''}${e.extraHtml}</li>`;
  });
  const scored = entries.map((e) => e.score).filter((s): s is number => s != null);
  const count = `${entries.length} attempt${entries.length === 1 ? '' : 's'}`;
  return `<div class="history-head"><span>${count}</span>${scored.length >= 2 ? sparkline(scored) : ''}</div>
    <ol class="history-list">${rows.reverse().join('')}</ol>`;
}
