// Pulls your best scores from fervidex.net's Score export and imports them,
// the same way the /settings/iidx/import-json page does. Runs weekly from
// .github/workflows/iidx-fervidex-sync.yml; can also be run by hand.
//
// Steps: log in to fervidex.net with a headless browser, open Settings > Score
// export, download each style's zip (ZINRAI and INFINITAS by default), check
// scores.json against its signature (scores.json.sig, fervidex's key is in
// fervidex-signing-key.asc), match charts by song ID, and upsert into `scores`
// signed in as the site owner. The scores trigger keeps the best of each field,
// so importing both styles is safe and an unchanged score changes nothing.
//
// Usage:
//   npx playwright install chromium   (once)
//   node --env-file=.env db/iidx/fervidex/sync.mjs --dry-run
//   Prints what would be imported and writes nothing. Drop --dry-run to import.
//
// Options:
//   --dry-run          Report only.
//   --styles A,B       Styles to export, as named in fervidex's Style dropdown
//                      (default ZINRAI,INFINITAS).
//   --zip <path>       Use an already-downloaded zip instead of logging in
//                      (repeatable). Its style is taken from the file name.
//   --out <dir>        Where to write zips and unmatched-*.csv (default fervidex-export).
//   --no-verify        Skip the signature check (needs gpg otherwise).
//
// Env (.env locally, GitHub secrets in the workflow; never commit them):
//   FERVIDEX_USERNAME, FERVIDEX_PASSWORD      fervidex.net login
//   PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY
//   IIDX_OWNER_EMAIL, IIDX_OWNER_PASSWORD     your rg-score-tracker login

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { unzipSync } from 'fflate';
import { loadChartLookup, matchScores } from '../../../src/games/iidx/score-export.ts';

const FERVIDEX_URL = process.env.FERVIDEX_URL ?? 'https://fervidex.net';
const SIGNING_KEY = join(dirname(fileURLToPath(import.meta.url)), 'fervidex-signing-key.asc');
const SIGNING_FINGERPRINT = '6F4C57D24AFBA700882A3BF142D1092F1A5BBC9A';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = flag('--dry-run');
const verify = !flag('--no-verify');
const outDir = option('--out') ?? 'fervidex-export';
const styles = (option('--styles') ?? 'ZINRAI,INFINITAS').split(',').map((s) => s.trim()).filter(Boolean);
const zipPaths = args.flatMap((a, i) => (a === '--zip' ? [args[i + 1]] : []));

function requireEnv(...names) {
  // Pasted secrets often carry a trailing newline, which breaks HTTP headers.
  const values = names.map((n) => process.env[n]?.trim());
  const missing = names.filter((n, i) => !values[i]);
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}`);
    process.exit(1);
  }
  const multiline = names.filter((n, i) => values[i].includes('\n'));
  if (multiline.length) {
    console.error(`These secrets hold more than one line; each should be a single value: ${multiline.join(', ')}`);
    process.exit(1);
  }
  return values;
}

const summary = [];
const log = (line = '') => {
  console.log(line);
  summary.push(line);
};

mkdirSync(outDir, { recursive: true });

// --- 1. Get the zips ---------------------------------------------------------

async function downloadExports() {
  const [username, password] = requireEnv('FERVIDEX_USERNAME', 'FERVIDEX_PASSWORD');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  try {
    await page.goto(FERVIDEX_URL);
    const userField = page.getByPlaceholder('Email or username');
    if (await userField.isVisible()) {
      await userField.fill(username);
      await page.getByPlaceholder('Password').fill(password);
      await page.getByRole('button', { name: 'Log in' }).click();
    }
    const logout = page.getByText('Logout', { exact: true });
    try {
      await logout.waitFor({ timeout: 20_000 });
    } catch {
      throw new Error('Login failed: no Logout link after logging in. Check FERVIDEX_USERNAME / FERVIDEX_PASSWORD.');
    }

    // Matched by text, not link role: fervidex's nav items aren't all plain links.
    await page.getByText('Settings', { exact: true }).first().click();
    await page.getByText('Score export', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Download' }).waitFor();

    const files = [];
    for (const style of styles) {
      await pickStyle(page, style);
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 120_000 }),
        page.getByRole('button', { name: 'Download' }).click(),
      ]);
      const path = join(outDir, `${style}.zip`);
      await download.saveAs(path);
      console.log(`Downloaded ${style} -> ${path}`);
      files.push({ style, path });
    }
    return files;
  } catch (err) {
    // The page's URL and controls, to see what changed if fervidex is redesigned.
    // No screenshot: the login form would show the username.
    console.error(`Failed at ${page.url()}`);
    const controls = await page.locator('a, button, select, label').allInnerTexts().catch(() => []);
    console.error(`Page controls: ${controls.map((t) => t.trim()).filter(Boolean).slice(0, 60).join(' | ')}`);
    throw err;
  } finally {
    await browser.close();
  }
}

// The Style dropdown: a native <select> or a styled one, depending on the page.
async function pickStyle(page, style) {
  const select = page.locator('select');
  if (await select.count()) {
    await select.first().selectOption({ label: style });
    return;
  }
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: style, exact: true }).click();
}

// --- 2. Read and verify scores.json -----------------------------------------

function readExport(path) {
  const entries = unzipSync(readFileSync(path));
  const name = Object.keys(entries).find((n) => basename(n) === 'scores.json');
  if (!name) throw new Error(`${path}: no scores.json in the zip (has ${Object.keys(entries).join(', ')})`);
  const json = entries[name];
  const sig = entries[`${name}.sig`];
  if (verify) verifySignature(path, json, sig);
  return JSON.parse(new TextDecoder().decode(json));
}

function verifySignature(path, json, sig) {
  if (!sig) throw new Error(`${path}: no scores.json.sig to verify against (use --no-verify to skip)`);
  const dir = mkdtempSync(join(tmpdir(), 'fervidex-gpg-'));
  try {
    writeFileSync(join(dir, 'scores.json'), json);
    writeFileSync(join(dir, 'scores.json.sig'), sig);
    const gpg = (...a) => execFileSync('gpg', ['--homedir', dir, '--batch', ...a], { stdio: 'pipe' }).toString();
    gpg('--import', SIGNING_KEY);
    // --status-fd prints machine-readable lines; VALIDSIG carries the signer's fingerprint.
    const status = gpg('--status-fd', '1', '--verify', join(dir, 'scores.json.sig'), join(dir, 'scores.json'));
    const valid = status.split('\n').find((l) => l.startsWith('[GNUPG:] VALIDSIG '));
    if (!valid?.split(' ').includes(SIGNING_FINGERPRINT)) throw new Error('not signed by the fervidex key');
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('gpg not found: install it, or pass --no-verify to skip the signature check');
    throw new Error(`${path}: signature check failed (${err.stderr?.toString().trim() || err.message})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- 3. Match and import ------------------------------------------------------

const files = zipPaths.length
  ? zipPaths.map((path) => ({ style: basename(path).replace(/\.zip$/i, ''), path }))
  : await downloadExports();

const [supabaseUrl, anonKey] = requireEnv('PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_ANON_KEY');
const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
if (!dryRun) {
  const [email, password] = requireEnv('IIDX_OWNER_EMAIL', 'IIDX_OWNER_PASSWORD');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error(`Supabase login failed: ${error.message}`);
    process.exit(1);
  }
}
const chartLookup = await loadChartLookup(supabase);

log(`## Fervidex score sync${dryRun ? ' (dry run)' : ''}`);
log();
let failed = false;
for (const { style, path } of files) {
  const { matched, noPlayCount, unmatched, unmatchedSongs } = matchScores(readExport(path), chartLookup);
  log(`**${style}**: ${matched.length} chart score(s) matched, ${noPlayCount} with no play skipped, ${unmatched.length} unmatched.`);

  if (unmatchedSongs.size) {
    const rows = [['external_id', 'chart', 'ex_score', 'clear_type', 'miss_count']];
    for (const [id, charts] of unmatchedSongs) {
      for (const { code, score } of charts) rows.push([id, code, score.ex_score ?? '', score.clear_type ?? '', score.miss_count ?? '']);
    }
    const csv = join(outDir, `unmatched-${style}.csv`);
    writeFileSync(csv, rows.map((r) => r.join(',')).join('\n') + '\n');
    log(`  Unmatched charts written to ${csv}. Link them on /settings/iidx/import-json.`);
  }

  if (dryRun || !matched.length) continue;
  // Ask for the rows back: RLS turns a write this account may not make into a
  // silent no-op, so fewer rows back than sent means something was refused.
  let written = 0;
  let importError = null;
  for (let i = 0; i < matched.length; i += 500) {
    const chunk = matched.slice(i, i + 500);
    const { data, error } = await supabase.from('scores').upsert(chunk, { onConflict: 'chart_id' }).select('chart_id');
    if (error) {
      importError = error.message;
      break;
    }
    written += data?.length ?? 0;
  }
  log(importError ? `  Import failed after ${written} score(s): ${importError}` : `  Imported ${written} of ${matched.length} score(s).`);
  if (written < matched.length) failed = true;
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
if (failed) process.exit(1);
