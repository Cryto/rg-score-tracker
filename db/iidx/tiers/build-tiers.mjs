// Builds src/games/iidx/tiers.json, the data behind the IIDX Tier view, from
// a tier-list workbook (.xlsx). No database involved: the view matches each
// listed chart to the catalog by title, play style and difficulty.
//
// The workbook has one tab per table, three columns each (header row first):
//   SP lv9 .. SP lv12   Tier ("地力A+", "個人差B", ...), Song Name, Chart ("SPA", "SPL", "SP黒")
//   SP lv12 CPI         CPI Range ("2000 ~ 2050"), Song Name, Chart
//   DP 5.0-5.9 ..       Rating (12.7), Song Name, Chart with level ("DPA 12")
// "lv" is optional ("SP 11"). A tab name can end with the lamp its list is
// for: Easy, Normal, Hard (or HC), EX Hard (or EXH), Full Combo (or FC), as
// in "SP 12 HC" or "SP 12 CPI EX Hard". Tabs without one use --lamp.
// Tiers keep the order they first appear in on each tab.
//
// Usage:
//   node db/iidx/tiers/build-tiers.mjs <tiers.xlsx> [--lamp CLEAR]
// --lamp is EASY_CLEAR, CLEAR (Normal, the default), HARD_CLEAR,
// EX_HARD_CLEAR or FULL_COMBO. Only the tables in the workbook are replaced;
// every other lamp's and table's list in tiers.json is kept.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const LAMPS = ['EASY_CLEAR', 'CLEAR', 'HARD_CLEAR', 'EX_HARD_CLEAR', 'FULL_COMBO'];
const OUT = new URL('../../../src/games/iidx/tiers.json', import.meta.url);

const args = process.argv.slice(2);
const lampIdx = args.indexOf('--lamp');
const lamp = lampIdx >= 0 ? args[lampIdx + 1] : 'CLEAR';
const xlsxPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--lamp');
if (!xlsxPath || !LAMPS.includes(lamp)) {
  console.error(`Usage: node db/iidx/tiers/build-tiers.mjs <tiers.xlsx> [--lamp ${LAMPS.join('|')}]`);
  process.exit(1);
}

// --- Minimal .xlsx reader (a zip of XML files), so no package is needed. ---

function unzip(buf) {
  const files = new Map();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not an .xlsx file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    files.set(name, method === 8 ? inflateRawSync(raw) : raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescapeXml = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) =>
    ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e] ??
    String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

// Text of an <si> or inline string: every <t> run joined.
const runText = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');

function readWorkbook(path) {
  const files = unzip(readFileSync(path));
  // Tag prefixes (<x:row>) are dropped so the patterns below match either form.
  const text = (name) => (files.get(name)?.toString('utf8') ?? '').replace(/<(\/?)\w+:/g, '<$1');
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runText(m[1]));
  const rels = new Map(
    [...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [
      m[1].match(/Id="([^"]+)"/)[1],
      m[1].match(/Target="([^"]+)"/)[1].replace(/^\/?(xl\/)?/, 'xl/'),
    ]),
  );
  const sheets = [];
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = unescapeXml(m[1].match(/name="([^"]+)"/)[1]);
    const rid = m[1].match(/r:id="([^"]+)"/)[1];
    const rows = [];
    for (const r of text(rels.get(rid)).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/r="([A-Z]+)\d+"/)[1];
        const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const type = c[1].match(/t="([^"]+)"/)?.[1];
        const body = c[2] ?? '';
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        row[col] = type === 's' ? shared[Number(v)] : type === 'inlineStr' ? runText(body) : v != null ? unescapeXml(v) : '';
      }
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

// --- Tabs to tables. ---

// Lamp suffixes on tab names, longest first so "EX Hard" isn't read as "Hard".
const LAMP_SUFFIXES = [
  [/\s+(EX\s*Hard|EXH|EXHC)$/i, 'EX_HARD_CLEAR'],
  [/\s+(Full\s*Combo|FC)$/i, 'FULL_COMBO'],
  [/\s+(Hard|HC)$/i, 'HARD_CLEAR'],
  [/\s+(Normal|NC)$/i, 'CLEAR'],
  [/\s+(Easy|EC)$/i, 'EASY_CLEAR'],
];

// "SP lv12 CPI" -> SP table ☆12 CPI; "DP 10.0-10.7" -> DP table 10.0 - 10.7.
function tableFor(tabName) {
  const sp = tabName.match(/^SP\s*(?:lv)?\s*(\d+)\s*(.*)$/i);
  if (sp) {
    const extra = sp[2].trim();
    return { id: `sp${sp[1]}${extra ? '-' + extra.toLowerCase() : ''}`, style: 'SP', label: `☆${sp[1]}${extra ? ' ' + extra : ''}`, level: Number(sp[1]) };
  }
  const dp = tabName.match(/^DP\s*([\d.]+)\s*-\s*([\d.]+)$/i);
  if (dp) return { id: `dp${dp[1]}-${dp[2]}`, style: 'DP', label: `${dp[1]} - ${dp[2]}`, level: null };
  return null;
}

// Dan course prefixes ("七段Wanna Party?") aren't part of the song title.
const DAN_PREFIX = /^[一二三四五六七八九十皆]段(?=\S)/;
// Titles the lists spell differently from the catalog (list title -> catalog title).
const ALIASES = {
  '.59': '0.59',
  '†渚の小悪魔ラヴリィ～レイディオ†(IIDX EDIT)': '†渚の小悪魔ラヴリィ～レイディオ†',
};

// DP ratings come through as numbers (11.8, or 11 for 11.0). CPI ranges are
// written "2000-2050", "2000 ~ 2050" or "適正CPI 2000 ~ 2050"; all become "2000 ~ 2050".
function tierName(v, isRating) {
  const s = String(v ?? '').trim();
  if (isRating && /^\d+(\.\d+)?$/.test(s)) return Number(s).toFixed(1);
  const range = s.match(/^(?:適正CPI\s*)?(\d+)\s*[~\-–]\s*(\d+)$/);
  return range ? `${range[1]} ~ ${range[2]}` : s;
}

// Tables per lamp, in the order the sidebar lists them.
const byLamp = new Map();
let skipped = 0;
for (const sheet of readWorkbook(xlsxPath)) {
  let tabName = sheet.name.trim();
  let tabLamp = lamp;
  for (const [re, l] of LAMP_SUFFIXES) {
    if (re.test(tabName)) {
      tabName = tabName.replace(re, '');
      tabLamp = l;
      break;
    }
  }
  const table = tableFor(tabName);
  if (!table) {
    console.warn(`Skipping tab "${sheet.name}" (name isn't "SP lv<n>[ ...]" or "DP <a>-<b>")`);
    continue;
  }
  const tiers = new Map();
  for (const row of sheet.rows.slice(1)) {
    const [tierCell, titleCell, chartCell] = row;
    if (!titleCell) continue;
    const chart = String(chartCell ?? '').trim().replace('黒', 'BA');
    const m = chart.match(/^(SP|DP)(B|N|H|A|L|BA)\s*(\d+)?$/);
    if (!m) {
      console.warn(`${sheet.name}: can't read chart "${chartCell}" for ${titleCell}`);
      skipped++;
      continue;
    }
    let title = String(titleCell).trim().replace(DAN_PREFIX, '');
    title = ALIASES[title] ?? title;
    const level = m[3] ? Number(m[3]) : table.level;
    const name = tierName(tierCell, table.style === 'DP');
    if (!tiers.has(name)) tiers.set(name, []);
    // [title, difficulty (BA = Black Another), level]
    tiers.get(name).push([title, m[2], level]);
  }
  if (!byLamp.has(tabLamp)) byLamp.set(tabLamp, []);
  byLamp.get(tabLamp).push({ ...table, tiers: [...tiers].map(([name, charts]) => ({ name, charts })) });
}

// SP before DP; by level (CPI after its level's tier list), DP by range start.
const tableOrder = (t) => (t.style === 'SP' ? 0 : 1000) + (t.level ?? parseFloat(t.label)) + (t.id.includes('-') && t.style === 'SP' ? 0.5 : 0);

const data = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { lamps: {} };
for (const [l, tables] of byLamp) {
  const ids = new Set(tables.map((t) => t.id));
  data.lamps[l] = [...(data.lamps[l] ?? []).filter((t) => !ids.has(t.id)), ...tables].sort((a, b) => tableOrder(a) - tableOrder(b));
  const total = tables.reduce((n, t) => n + t.tiers.reduce((m, tier) => m + tier.charts.length, 0), 0);
  console.log(`${l}: ${tables.length} tables, ${total} charts`);
  for (const t of tables) console.log(`  ${t.style} ${t.label}: ${t.tiers.length} tiers`);
}
// Lamps in sidebar order.
data.lamps = Object.fromEntries(LAMPS.filter((l) => data.lamps[l]).map((l) => [l, data.lamps[l]]));
writeFileSync(OUT, JSON.stringify(data, null, 0).replace(/\],\[/g, '],\n[') + '\n');
console.log(`${skipped ? `${skipped} rows skipped. ` : ''}Wrote src/games/iidx/tiers.json`);
