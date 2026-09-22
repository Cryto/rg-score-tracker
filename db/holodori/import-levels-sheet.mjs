// Rebuilds db/holodori/levels.csv from the user's level sheet (a CSV export
// with columns: Song Name, Easy, Normal, Hard, Expert).
//
// Sheet names are matched to songs.json by title (JP or EN), ignoring width,
// case, spacing and common punctuation. Songs in the sheet that aren't on the
// official music page are kept as sheet-only rows (blank order/title_en) so
// they can still be tracked. Official songs missing from the sheet keep
// blank levels.
//
// Usage: node db/holodori/import-levels-sheet.mjs <sheet.csv>
//   e.g. curl -L "https://docs.google.com/spreadsheets/d/<id>/export?format=csv" -o sheet.csv
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCsv, csvField } from './csv.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIFFS = ['easy', 'normal', 'hard', 'expert'];
// Byte-order mark (U+FEFF): stripped from input, prepended to output so Excel
// opens the Japanese titles correctly.
const BOM = String.fromCharCode(0xfeff);
const BOM_RE = new RegExp(`^${BOM}`);

// Sheet spelling -> official JP title, for names normalization can't bridge.
const ALIASES = {
  '地獄であおうぜ！スバちょこるなたん': '地獄で会おうぜ！ スバちょこるなたん',
};

const norm = (s) => (s ?? '').normalize('NFKC').toLowerCase()
  .replace(/[\s・·.,!?~〜☆★♡♪'’"“”()[\]「」『』:\-‐―–—_/]/g, '');

const sheetPath = process.argv[2];
if (!sheetPath) { console.error('Usage: node db/holodori/import-levels-sheet.mjs <sheet.csv>'); process.exit(1); }

const songs = JSON.parse(fs.readFileSync(path.join(DIR, 'songs.json'), 'utf8'));
const byTitle = new Map();
for (const s of songs) for (const t of [s.title_jp, s.title_en]) if (t) byTitle.set(norm(t), s);

const [header, ...body] = parseCsv(fs.readFileSync(sheetPath, 'utf8').replace(BOM_RE, ''));
if (!/song/i.test(header[0] ?? '')) throw new Error(`Unexpected header: ${header.join(',')}`);

const levelsByOrder = new Map();
const sheetOnly = [];
const problems = [];
for (const r of body) {
  const name = r[0]?.trim();
  if (!name) continue;
  const levels = r.slice(1, 5).map((v) => v.trim());
  const bad = levels.filter((v) => v && !/^\d+$/.test(v));
  if (bad.length) problems.push(`${name}: non-numeric level(s) ${bad.join(', ')}`);
  const nums = levels.map((v) => (v ? Number(v) : null));
  const filled = nums.filter((n) => n != null);
  if (filled.some((n, i) => i && n < filled[i - 1])) problems.push(`${name}: levels not ascending (${levels.join('/')})`);

  const song = byTitle.get(norm(ALIASES[name] ?? name));
  if (!song) { sheetOnly.push({ name, levels }); continue; }
  if (levelsByOrder.has(song.order)) problems.push(`${name}: duplicate row for "${song.title_jp}"`);
  levelsByOrder.set(song.order, levels);
}

const lines = [['order', 'title_en', 'title_jp', ...DIFFS].join(',')];
for (const s of songs) lines.push([s.order, s.title_en, s.title_jp, ...(levelsByOrder.get(s.order) ?? ['', '', '', ''])].map(csvField).join(','));
for (const s of sheetOnly) lines.push(['', '', s.name, ...s.levels].map(csvField).join(','));
fs.writeFileSync(path.join(DIR, 'levels.csv'), BOM + lines.join('\r\n') + '\r\n');

const missing = songs.filter((s) => !levelsByOrder.has(s.order));
console.log(`Official songs with levels: ${levelsByOrder.size}/${songs.length}`);
console.log(`Sheet-only songs (not on the official music page): ${sheetOnly.length}`);
if (missing.length) console.log(`Official songs with no sheet row:\n  ${missing.map((s) => s.title_jp).join('\n  ')}`);
if (problems.length) console.log(`Check these:\n  ${problems.join('\n  ')}`);
