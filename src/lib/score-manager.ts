// "Current score & history" panel for the add/update score pages: shows the
// selected chart's best score and its logged attempts, and lets the owner
// remove the score or delete single attempts (e.g. a mistyped score, which
// ratcheting would otherwise keep forever). The two are independent: removing
// the score leaves the attempts, and deleting an attempt never changes the
// score. Shared by IIDX and Holodori; each page supplies its columns and how
// to describe a row.
import type { SupabaseClient } from '@supabase/supabase-js';

type Options = {
  client: SupabaseClient;
  scoreColumns: string;
  attemptColumns: string;
  /** Plain-text summary of a score or attempt row, e.g. "1,234,567 · S+ · Full Combo". */
  describe: (row: any) => string;
  /** Migration to point at when a delete is silently blocked by RLS. */
  migration: string;
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function scoreManager(el: HTMLElement, opts: Options) {
  let chartId: number | null = null;
  let title = '';
  let note = '';

  // RLS doesn't error on a blocked delete, it just deletes nothing.
  const blocked = `Nothing was deleted. If you're logged in, the owner delete policy may not be set up yet (run ${opts.migration}).`;

  async function render() {
    if (chartId == null) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const id = chartId;
    el.hidden = false;
    el.innerHTML = `<h2>Current score &amp; history</h2><p class="sm-chart">${escapeHtml(title)}</p><p class="sm-muted">Loading…</p>`;
    const [scoreRes, attemptsRes] = await Promise.all([
      opts.client.from('scores').select(opts.scoreColumns).eq('chart_id', id).maybeSingle(),
      opts.client.from('score_attempts').select(`id, submitted_at, ${opts.attemptColumns}`).eq('chart_id', id)
        .order('submitted_at', { ascending: false }).order('id', { ascending: false }),
    ]);
    if (id !== chartId) return; // another chart was picked while loading
    const error = scoreRes.error ?? attemptsRes.error;
    if (error) {
      el.querySelector('.sm-muted')!.textContent = `Couldn't load: ${error.message}`;
      return;
    }
    const score = scoreRes.data as any;
    const attempts = (attemptsRes.data ?? []) as any[];
    el.innerHTML = `<h2>Current score &amp; history</h2>
      <p class="sm-chart">${escapeHtml(title)}</p>
      <div class="sm-current">${score
        ? `<span><strong>Best:</strong> ${escapeHtml(opts.describe(score))}</span>
           <button type="button" class="sm-remove">Remove score</button>`
        : '<span class="sm-muted">No score recorded.</span>'}</div>
      <h3>Attempts <span class="sm-muted">(newest first)</span></h3>
      ${attempts.length
        ? `<ol class="sm-attempts">${attempts.map((a) => `<li>
            <span class="sm-when">${when(a.submitted_at)}</span>
            <span>${escapeHtml(opts.describe(a))}</span>
            <button type="button" class="sm-delete" data-id="${a.id}" aria-label="Delete the attempt from ${when(a.submitted_at)}" title="Delete this attempt">✕</button>
          </li>`).join('')}</ol>`
        : '<p class="sm-muted">No attempts logged.</p>'}
      <p class="sm-note" role="status">${escapeHtml(note)}</p>`;
    note = '';

    el.querySelector('.sm-remove')?.addEventListener('click', async () => {
      if (!confirm(`Remove the score for ${title}?\n\nBest: ${opts.describe(score)}\n\nThe attempt history is kept; delete attempts separately if needed.`)) return;
      const { data, error } = await opts.client.from('scores').delete().eq('chart_id', id).select('chart_id');
      note = error ? `Error: ${error.message}` : data?.length ? 'Score removed.' : blocked;
      render();
    });
    el.querySelectorAll<HTMLButtonElement>('.sm-delete').forEach((btn) => btn.addEventListener('click', async () => {
      const attempt = attempts.find((a) => a.id === Number(btn.dataset.id));
      if (!confirm(`Delete this attempt?\n\n${when(attempt.submitted_at)}: ${opts.describe(attempt)}\n\nThe current best score isn't changed.`)) return;
      const { data, error } = await opts.client.from('score_attempts').delete().eq('id', attempt.id).select('id');
      note = error ? `Error: ${error.message}` : data?.length ? 'Attempt deleted.' : blocked;
      render();
    }));
  }

  return {
    /** Shows the panel for a chart (or hides it for null); call again after saving to refresh. */
    show(id: number | null, chartTitle = '') {
      chartId = id;
      title = chartTitle;
      return render();
    },
  };
}
