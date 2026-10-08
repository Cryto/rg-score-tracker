// IIDX Song view: one record per song and play style (SP and DP are separate
// records), with a cell per difficulty, like the Holodori list. A difficulty
// cell opens that chart's history; the song title opens its song info.

import { computeGrade, LAMP_LABELS, type ClearLamp } from './grade';

/** The parts of a list-view row the song view needs. */
export type SongViewRow = {
  chartId: number;
  songId: number;
  version: string;
  title: string;
  titleEnglish: string;
  artist: string;
  wikiUrl: string | null;
  style: string;
  difficulty: string;
  level: number;
  noteCount: number | null;
  bpmMin: number | null;
  bpmMax: number | null;
  chartLabel: string | null;
  exScore: number | null;
  lamp: string | null;
  missCount: number | null;
};

export type SongRecord<R extends SongViewRow = SongViewRow> = { key: string; style: string; charts: R[]; first: R };

export const DIFFS = ['B', 'N', 'H', 'A', 'L'] as const;
export const DIFF_NAMES: Record<string, string> = { B: 'Beginner', N: 'Normal', H: 'Hyper', A: 'Another', L: 'Leggendaria' };
// Colors of the in-game difficulty labels.
export const DIFF_COLORS: Record<string, string> = { B: '#5cc85c', N: '#3d9bff', H: '#f5b324', A: '#ff4d57', L: '#b45cff' };

/** Groups rows into song records, in the order each record's first row appears. */
export function songRecords<R extends SongViewRow>(rows: R[]): SongRecord<R>[] {
  const byKey = new Map<string, SongRecord<R>>();
  for (const r of rows) {
    const key = `${r.songId}|${r.style}`;
    const rec = byKey.get(key);
    if (rec) rec.charts.push(r);
    else byKey.set(key, { key, style: r.style, charts: [r], first: r });
  }
  for (const rec of byKey.values()) {
    // Difficulty order; a Black Another sorts after the song's Leggendaria.
    rec.charts.sort((a, b) => DIFFS.indexOf(a.difficulty as never) - DIFFS.indexOf(b.difficulty as never) || Number(!!a.chartLabel) - Number(!!b.chartLabel));
  }
  return [...byKey.values()];
}

/** EX score as a percentage of the chart's max (note count × 2), 2 decimals. */
export function exPercent(exScore: number | null, noteCount: number | null): string | null {
  return exScore != null && noteCount ? `${((exScore / (noteCount * 2)) * 100).toFixed(2)}%` : null;
}

function chartCell(r: SongViewRow, dim: boolean, showPct: boolean): string {
  const name = r.chartLabel ?? DIFF_NAMES[r.difficulty] ?? r.difficulty;
  const grade = computeGrade(r.exScore, r.noteCount);
  const lampLabel = r.lamp ? LAMP_LABELS[r.lamp as ClearLamp] : 'No Play';
  const pct = showPct ? exPercent(r.exScore, r.noteCount) : null;
  const played = r.exScore != null || r.lamp != null;
  return `<div class="sv-chart${dim ? ' dim' : ''}${played ? '' : ' unplayed'}" style="--diff:${DIFF_COLORS[r.difficulty] ?? '#888'}" data-chart-id="${r.chartId}" role="button" tabindex="0" aria-expanded="false" title="${esc(`${name} ${r.level}: ${lampLabel}. Show history`)}">
      <span class="sv-diff-name">${esc(name)}</span>
      <span class="sv-level">${r.level}</span>
      <span class="sv-ex">${r.exScore != null ? r.exScore.toLocaleString('en-US') : '—'}</span>
      <span class="sv-grade">${grade === '—' ? '' : grade}${pct ? `<small>${pct}</small>` : ''}</span>
      <span class="iidx-lamp" data-lamp="${r.lamp ?? 'NO_PLAY'}" aria-label="${lampLabel}"></span>
    </div>`;
}

export function songRecordHtml(rec: SongRecord, inFilter: Set<number>, showPct: boolean): string {
  const s = rec.first;
  // Each difficulty keeps its column (an empty slot when the song lacks it);
  // a second Leggendaria (Black Another) follows at the end.
  const cells: string[] = [];
  const extra: string[] = [];
  for (const d of DIFFS) {
    const charts = rec.charts.filter((c) => c.difficulty === d);
    cells.push(charts.length ? chartCell(charts[0], !inFilter.has(charts[0].chartId), showPct) : `<div class="sv-chart sv-none" aria-hidden="true"></div>`);
    for (const c of charts.slice(1)) extra.push(chartCell(c, !inFilter.has(c.chartId), showPct));
  }
  const sub = [s.artist, s.titleEnglish && s.titleEnglish !== s.title ? s.titleEnglish : null].filter(Boolean) as string[];
  return `<div class="sv-song" data-key="${esc(rec.key)}">
      <div class="sv-head" role="button" tabindex="0" aria-expanded="false" title="Show song info">
        <span class="sv-style sv-style-${rec.style}">${rec.style}</span>
        <div class="sv-title"><div class="sv-title-main">${esc(s.title)}</div>${sub.length ? `<div class="row-subtitle">${sub.map(esc).join(' · ')}</div>` : ''}</div>
      </div>
      <div class="sv-charts" style="--cols:${phoneColumns(rec.charts.length)}">${cells.join('')}${extra.join('')}</div>
    </div>`;
}

// On phones the cells wrap under the title: up to 3 across, and 4 as 2×2.
function phoneColumns(n: number): number {
  return n === 4 ? 2 : Math.min(n, 3);
}

/** Song info panel: version, BPM, note counts per chart, RemyWiki link. */
export function songInfoHtml(rec: SongRecord): string {
  const s = rec.first;
  const bpm = s.bpmMin == null ? '—' : s.bpmMax != null && s.bpmMax !== s.bpmMin ? `${s.bpmMin}–${s.bpmMax}` : `${s.bpmMin}`;
  const notes = rec.charts
    .map((c) => `<span class="sv-note" style="--diff:${DIFF_COLORS[c.difficulty]}">${esc(c.chartLabel ?? DIFF_NAMES[c.difficulty])} <strong>${c.noteCount ?? '—'}</strong></span>`)
    .join('');
  const wiki = s.wikiUrl && /^https?:\/\//i.test(s.wikiUrl.trim()) ? s.wikiUrl.trim() : null;
  return `<div class="sv-panel sv-info">
      <span><strong>Version:</strong> ${esc(s.version)}</span>
      <span><strong>BPM:</strong> ${bpm}</span>
      ${s.artist ? `<span><strong>Artist:</strong> ${esc(s.artist)}</span>` : ''}
      ${wiki ? `<a class="wiki-link" href="${esc(wiki)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(s.title)} on RemyWiki"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>Wiki</a>` : ''}
      <div class="sv-notes"><strong>Notes:</strong> ${notes}</div>
    </div>`;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
