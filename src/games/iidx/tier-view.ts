// IIDX Tier view: community tier lists (src/games/iidx/tiers.json, built by
// db/iidx/tiers/build-tiers.mjs) laid over the owner's lamps. Each listed
// chart is matched to the catalog by title, play style and difficulty, so no
// database table is involved.

import { computeGrade, LAMP_LABELS, LAMP_COLORS, LAMP_FILLS, LAMP_DARK_TEXT, type ClearLamp } from './grade';
import { searchKey } from '@/lib/search';

/** The parts of a list-view row the tier view needs. */
export type TierRow = {
  chartId: number;
  title: string;
  artist: string;
  style: string;
  difficulty: string;
  level: number;
  noteCount: number | null;
  chartLabel: string | null;
  exScore: number | null;
  lamp: string | null;
  missCount: number | null;
};

// [title, difficulty (BA = Black Another), level]
type TierEntry = [string, string, number | null];
type TierTable = { id: string; style: 'SP' | 'DP'; label: string; level: number | null; tiers: { name: string; charts: TierEntry[] }[] };
export type TierData = { lamps: Partial<Record<TargetLamp, TierTable[]>> };

/** Lamps a tier list can be for, in the sidebar's order. */
export const TARGET_LAMPS = ['EASY_CLEAR', 'CLEAR', 'HARD_CLEAR', 'EX_HARD_CLEAR', 'FULL_COMBO'] as const;
export type TargetLamp = (typeof TARGET_LAMPS)[number];
const TARGET_LABELS: Record<TargetLamp, string> = {
  EASY_CLEAR: 'Easy', CLEAR: 'Normal', HARD_CLEAR: 'Hard', EX_HARD_CLEAR: 'EX Hard', FULL_COMBO: 'Full Combo',
};
// "CLEAR+ 5/18": charts at the target lamp or better.
const TARGET_BADGES: Record<TargetLamp, string> = {
  EASY_CLEAR: 'EASY+', CLEAR: 'CLEAR+', HARD_CLEAR: 'HARD+', EX_HARD_CLEAR: 'EX HARD+', FULL_COMBO: 'FC',
};

// Best lamp first; the graph's segments run in this order, left to right.
const LAMP_ORDER = ['FULL_COMBO', 'EX_HARD_CLEAR', 'HARD_CLEAR', 'CLEAR', 'EASY_CLEAR', 'ASSIST_CLEAR', 'FAILED', 'NO_PLAY'] as const;
type LampKey = (typeof LAMP_ORDER)[number];
const LAMP_RANK: Record<string, number> = {
  NO_PLAY: 0, FAILED: 1, ASSIST_CLEAR: 2, EASY_CLEAR: 3, CLEAR: 4, HARD_CLEAR: 5, EX_HARD_CLEAR: 6, FULL_COMBO: 7,
};
const NO_PLAY_COLOR = '#3a3d46';
const lampLabel = (k: LampKey) => (k === 'NO_PLAY' ? 'No Play' : LAMP_LABELS[k]);
const lampFill = (k: LampKey) => (k === 'NO_PLAY' ? NO_PLAY_COLOR : LAMP_FILLS[k] ?? LAMP_COLORS[k]);
const lampColor = (k: LampKey) => (k === 'NO_PLAY' ? NO_PLAY_COLOR : LAMP_COLORS[k]);

// Titles in the lists differ from the catalog in width, case, spacing,
// punctuation and hiragana/katakana (共犯へヴンズコード vs 共犯ヘヴンズコード),
// so both sides are folded the same way before comparing.
function titleKey(title: string): string {
  const folded = searchKey(title).replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  const stripped = folded.replace(/[\s\p{P}\p{S}]+/gu, '');
  // Titles made only of symbols (≡+≡, ∀) keep them, so they can't collide.
  return stripped || folded.replace(/\s+/g, '');
}

type Item = { entry: TierEntry; row: TierRow | null; lamp: LampKey };

export type TierViewState = { lamp: TargetLamp; table: string };

export class TierView {
  private index = new Map<string, TierRow[]>();
  private openCard: string | null = null;
  // Play style groups in the Tables list the owner opened or closed.
  private openGroups = new Map<string, boolean>();
  private counts = new Map<TierTable, number>();

  constructor(
    private data: TierData,
    rows: TierRow[],
    private els: { main: HTMLElement; lamps: HTMLElement; tables: HTMLElement; tiers: HTMLElement },
    private onNavigate: (state: TierViewState) => void,
    private onJump: () => void,
  ) {
    for (const r of rows) {
      const key = `${r.style}|${r.difficulty}|${titleKey(r.title)}`;
      const list = this.index.get(key);
      if (list) list.push(r);
      else this.index.set(key, [r]);
    }
    // Cards toggle their score line; the graph and sidebar tier list jump to a section.
    els.main.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const jump = target.closest<HTMLElement>('[data-jump]');
      if (jump) return this.jumpTo(jump.dataset.jump!);
      const card = target.closest<HTMLElement>('.tier-card[data-card]');
      if (card) {
        const open = !card.classList.contains('open');
        els.main.querySelectorAll('.tier-card.open').forEach((c) => c.classList.remove('open'));
        card.classList.toggle('open', open);
        this.openCard = open ? card.dataset.card! : null;
      }
    });
    els.main.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).matches('.tier-card[data-card]')) {
        e.preventDefault();
        (e.target as HTMLElement).click();
      }
    });
    els.tiers.addEventListener('click', (e) => {
      const jump = (e.target as HTMLElement).closest<HTMLElement>('[data-jump]');
      if (jump) {
        this.onJump();
        this.jumpTo(jump.dataset.jump!);
      }
    });
    for (const el of [els.lamps, els.tables]) {
      el.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-lamp], button[data-table]');
        if (!btn) return;
        const state = this.state;
        if (btn.dataset.lamp) state.lamp = btn.dataset.lamp as TargetLamp;
        if (btn.dataset.table) state.table = btn.dataset.table;
        this.onNavigate(this.resolve(state));
        if (btn.dataset.table) this.onJump();
      });
    }
    // <details> toggle events don't bubble, so listen in the capture phase.
    els.tables.addEventListener('toggle', (e) => {
      const group = e.target as HTMLDetailsElement;
      if (group.dataset.style) this.openGroups.set(group.dataset.style, group.open);
    }, true);
    this.initGraphTooltip();
  }

  /** Charts in a table that are in the catalog (the ones the view shows). */
  private chartCount(table: TierTable): number {
    let n = this.counts.get(table);
    if (n == null) {
      n = table.tiers.reduce((sum, tier) => sum + tier.charts.filter((c) => this.match(c, table.style).row).length, 0);
      this.counts.set(table, n);
    }
    return n;
  }

  private state: TierViewState = { lamp: 'CLEAR', table: '' };

  /** Every table with a list for any lamp, in sidebar order (SP by level, CPI after its level, then DP). */
  get tables(): TierTable[] {
    const byId = new Map<string, TierTable>();
    for (const l of TARGET_LAMPS) for (const t of this.data.lamps[l] ?? []) if (!byId.has(t.id)) byId.set(t.id, t);
    const order = (t: TierTable) => (t.style === 'SP' ? 0 : 1000) + (t.level ?? parseFloat(t.label)) + (t.style === 'SP' && t.id.includes('-') ? 0.5 : 0);
    return [...byId.values()].sort((a, b) => order(a) - order(b));
  }

  /** Lamps that have a list for this table: the table decides which Clear buttons show. */
  lampsFor(tableId: string): TargetLamp[] {
    return TARGET_LAMPS.filter((l) => this.data.lamps[l]?.some((t) => t.id === tableId));
  }

  /** Falls back to the first table, and to Normal (or the table's first lamp), when a link names one that doesn't exist. */
  resolve(state: Partial<TierViewState>): TierViewState {
    const tables = this.tables;
    const table = tables.some((t) => t.id === state.table) ? state.table! : tables[0]?.id ?? '';
    const lamps = this.lampsFor(table);
    const lamp = state.lamp && lamps.includes(state.lamp) ? state.lamp : lamps.includes('CLEAR') ? 'CLEAR' : lamps[0] ?? 'CLEAR';
    return { lamp, table };
  }

  render(state: TierViewState, search: string) {
    this.state = state;
    const table = this.data.lamps[state.lamp]?.find((t) => t.id === state.table);
    this.renderSidebar(this.tables);
    if (!table) {
      this.els.main.innerHTML = '<p class="tier-empty">No tier lists yet.</p>';
      this.els.tiers.innerHTML = '';
      return;
    }

    const tiers = table.tiers.map((tier, i) => {
      // Charts the catalog doesn't have yet are left out (a data cleanup task).
      const items = tier.charts.map((entry) => this.match(entry, table.style)).filter((it) => it.row);
      // Best lamp, then best score (as a share of max, so levels compare), then title.
      items.sort((a, b) => LAMP_RANK[b.lamp] - LAMP_RANK[a.lamp] || scoreRate(b.row) - scoreRate(a.row) || a.row!.title.localeCompare(b.row!.title));
      return { id: `tier-${i}`, name: tier.name, items };
    }).filter((t) => t.items.length);
    const all = tiers.flatMap((t) => t.items);
    const targetRank = LAMP_RANK[state.lamp];
    const reached = (items: Item[]) => items.filter((it) => LAMP_RANK[it.lamp] >= targetRank).length;
    const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '0%');
    const badge = TARGET_BADGES[state.lamp];

    this.els.tiers.innerHTML = tiers
      .map((t) => `<button type="button" class="tier-side-row" data-jump="${t.id}"><span>${esc(t.name)}</span><span class="tier-side-count">${t.items.length}</span></button>`)
      .join('');

    const heading = `${table.style === 'SP' ? 'Single Play' : 'Double Play'} ${table.label}`;
    const summary = `<div class="tier-summary">
        <div class="tier-summary-title"><h2>${esc(heading)}</h2><span class="tier-summary-lamp">${TARGET_LABELS[state.lamp]} tier</span></div>
        <div class="tier-stats">
          <div><span class="tier-stat-label">Charts</span><span class="tier-stat-value">${all.length}</span></div>
          <div><span class="tier-stat-label">${badge}</span><span class="tier-stat-value">${reached(all)} <small>(${pct(reached(all), all.length)})</small></span></div>
          <div><span class="tier-stat-label">Played</span><span class="tier-stat-value">${all.filter((it) => it.lamp !== 'NO_PLAY').length}</span></div>
        </div>
      </div>`;

    const graph = `<div class="tier-graph" role="list">
        ${tiers.map((t) => {
          const counts = countLamps(t.items);
          const segs = LAMP_ORDER.filter((k) => counts[k])
            .map((k) => `<span class="tier-seg" style="width:${(counts[k] / t.items.length) * 100}%;background:${lampFill(k)}"></span>`)
            .join('');
          return `<button type="button" class="tier-graph-row" role="listitem" data-jump="${t.id}" data-counts="${esc(JSON.stringify(counts))}" data-name="${esc(t.name)}">
              <span class="tier-graph-label">${esc(t.name)}</span>
              <span class="tier-graph-bar">${segs}</span>
              <span class="tier-graph-value">${reached(t.items)}/${t.items.length}</span>
            </button>`;
        }).join('')}
      </div>
      <div class="tier-legend">${LAMP_ORDER.map((k) => `<span><i style="background:${lampFill(k)}"></i>${lampLabel(k)}</span>`).join('')}</div>`;

    const sections = tiers.map((t) => {
      const cards = t.items.filter((it) => !search || searchKey(`${it.row!.title} ${it.row!.artist}`).includes(search));
      if (search && !cards.length) return '';
      const n = reached(t.items);
      return `<section class="tier-section" id="${t.id}">
          <header class="tier-section-head">
            <h3>${esc(t.name)}</h3>
            <span class="tier-badge${n === t.items.length ? ' done' : ''}">${badge} ${n}/${t.items.length} (${pct(n, t.items.length)})</span>
          </header>
          <div class="tier-grid">${cards.map((it) => this.card(it)).join('')}</div>
        </section>`;
    }).join('');

    this.els.main.innerHTML = summary + graph + (sections || '<p class="tier-empty">No charts match the search.</p>');
  }

  private renderSidebar(tables: TierTable[]) {
    // Only the selected lamp's button takes the lamp's color.
    this.els.lamps.innerHTML = this.lampsFor(this.state.table)
      .map((l) => {
        const on = l === this.state.lamp;
        const style = on ? ` style="--lamp-fill:${lampFill(l)};--lamp-text:${LAMP_DARK_TEXT.has(l) ? '#111' : '#fff'}"` : '';
        return `<button type="button" class="tier-pick tier-lamp-pick${on ? ' active' : ''}" data-lamp="${l}" aria-pressed="${on}"${style}>${TARGET_LABELS[l]}</button>`;
      })
      .join('');
    const active = tables.find((t) => t.id === this.state.table);
    const groups = (['SP', 'DP'] as const)
      .map((style) => {
        const list = tables.filter((t) => t.style === style);
        if (!list.length) return '';
        // Collapsible per play style; the active table's group starts open.
        const open = this.openGroups.get(style) ?? active?.style === style;
        const rows = list
          .map((t) => `<button type="button" class="tier-side-row tier-table-row${t.id === this.state.table ? ' active' : ''}" data-table="${esc(t.id)}"${t.id === this.state.table ? ' aria-current="true"' : ''}><span>${esc(t.label)}</span><span class="tier-side-count">${this.chartCount(this.data.lamps[this.state.lamp]?.find((x) => x.id === t.id) ?? t)}</span></button>`)
          .join('');
        return `<details class="tier-table-group" data-style="${style}"${open ? ' open' : ''}><summary>${style === 'SP' ? 'Single Play' : 'Double Play'}</summary><div class="tier-side-tiers">${rows}</div></details>`;
      })
      .join('');
    this.els.tables.innerHTML = groups;
  }

  private match(entry: TierEntry, style: string): Item {
    const [title, diff, level] = entry;
    const difficulty = diff === 'BA' ? 'L' : diff;
    const found = this.index.get(`${style}|${difficulty}|${titleKey(title)}`) ?? [];
    // A song can have both a Leggendaria and a Black Another chart (both L);
    // the chart label tells them apart. Level breaks any remaining tie.
    const byLabel = found.filter((r) => (diff === 'BA') === (r.chartLabel === 'Black Another'));
    const pool = byLabel.length ? byLabel : found;
    const row = pool.find((r) => r.level === level) ?? pool[0] ?? null;
    return { entry, row, lamp: (row?.lamp as LampKey | null) ?? 'NO_PLAY' };
  }

  private card(it: Item): string {
    const level = it.entry[2];
    const r = it.row!;
    const chip = `${r.style}${r.difficulty}`;
    const chipClass = `chip-${r.difficulty}`;
    const lamp = it.lamp;
    const grade = computeGrade(r.exScore, r.noteCount);
    const percent = r.exScore != null && r.noteCount ? `${((r.exScore / (r.noteCount * 2)) * 100).toFixed(2)}%` : null;
    const key = String(r.chartId);
    const dark = lamp !== 'NO_PLAY' && LAMP_DARK_TEXT.has(lamp as ClearLamp);
    return `<div class="tier-card${this.openCard === key ? ' open' : ''}" data-card="${key}" data-lamp="${lamp}" style="--lamp:${lampColor(lamp)}" tabindex="0" role="button" aria-label="${esc(`${r.title} ${chip} ${r.level}, ${lampLabel(lamp)}`)}">
        <div class="tier-card-top"><span class="tier-card-title">${esc(r.title)}${r.chartLabel ? ` <small>(${esc(r.chartLabel)})</small>` : ''}</span><span class="tier-chip ${chipClass}">${chip}</span></div>
        <div class="tier-card-meta"><span>Lv ${r.level}${level != null && level !== r.level ? ` <span class="tier-dim" title="Level in the tier list">(list: ${level})</span>` : ''}</span><span class="tier-card-lamp${dark ? ' light' : ''}">${lampLabel(lamp)}</span></div>
        <div class="tier-card-score">
          <span><b>EX</b> ${r.exScore != null ? r.exScore.toLocaleString() : '—'}</span>
          <span><b>Grade</b> ${grade}${percent ? ` <small>${percent}</small>` : ''}</span>
          <span><b>BP</b> ${r.missCount ?? '—'}</span>
        </div>
      </div>`;
  }

  private jumpTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // One shared tooltip: hovering a graph row shows that tier's count and
  // share for every lamp.
  private initGraphTooltip() {
    const tip = document.createElement('div');
    tip.className = 'tier-tooltip';
    tip.hidden = true;
    document.body.appendChild(tip);
    const main = this.els.main;
    main.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const row = (e.target as HTMLElement).closest<HTMLElement>('.tier-graph-row');
      if (!row) {
        tip.hidden = true;
        return;
      }
      const counts = JSON.parse(row.dataset.counts!) as Record<LampKey, number>;
      const total = LAMP_ORDER.reduce((n, k) => n + counts[k], 0);
      tip.innerHTML = `<div class="tier-tooltip-title">${esc(row.dataset.name!)} <span>${total} charts</span></div>${LAMP_ORDER.map(
        (k) => `<div class="tier-tooltip-row${counts[k] ? '' : ' zero'}"><i style="background:${lampFill(k)}"></i><span>${lampLabel(k)}</span><b>${counts[k]}</b><span>${total ? ((counts[k] / total) * 100).toFixed(1) : '0.0'}%</span></div>`,
      ).join('')}`;
      tip.hidden = false;
      const pad = 14;
      const { width, height } = tip.getBoundingClientRect();
      const x = Math.min(e.clientX + pad, window.innerWidth - width - 8);
      const y = e.clientY + pad + height > window.innerHeight ? e.clientY - height - pad : e.clientY + pad;
      tip.style.transform = `translate(${x}px, ${y}px)`;
    });
    main.addEventListener('pointerleave', () => (tip.hidden = true));
    window.addEventListener('scroll', () => (tip.hidden = true), { passive: true });
  }
}

// EX score as a share of the chart's max; unscored charts sort last.
function scoreRate(r: TierRow | null): number {
  return r?.exScore != null && r.noteCount ? r.exScore / (r.noteCount * 2) : -1;
}

function countLamps(items: Item[]): Record<LampKey, number> {
  const counts = Object.fromEntries(LAMP_ORDER.map((k) => [k, 0])) as Record<LampKey, number>;
  for (const it of items) counts[it.lamp]++;
  return counts;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
