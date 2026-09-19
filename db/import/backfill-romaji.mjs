// Automated romaji backfill for songs whose title_english is still empty
// after the iidx-db import + the user's reviewed sheet sync (~2% of the
// catalog -- titles the source data never covered). Uses kuroshiro to
// convert kanji/kana titles to romaji automatically.
//
// Usage: node --env-file=.env db/import/backfill-romaji.mjs
//
// Automated romanization of stylized song titles is often rough (kuroshiro
// doesn't know IIDX naming conventions), so treat this as a starting point,
// not a final answer -- spot-check the results, especially titles with
// unusual stylization or mixed scripts.

import { createClient } from '@supabase/supabase-js';
// kuroshiro's ESM/CJS interop double-wraps its default export.
import KuroshiroModule from 'kuroshiro';
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji';
const Kuroshiro = KuroshiroModule.default ?? KuroshiroModule;

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey);

const kuroshiro = new Kuroshiro();
await kuroshiro.init(new KuromojiAnalyzer());

// Only titles containing at least one Japanese character need romanization --
// skip titles that are already plain ASCII/Latin.
const JAPANESE_RE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;

// kuroshiro's raw "spaced" output pads every token and punctuation mark with
// spaces (e.g. "ft ." instead of "ft.", "~ text ~" instead of "~text~") and
// lowercases everything. This hugs punctuation back together and
// title-cases each word -- still rough for names/particles, but much closer
// to how these titles actually get written.
function cleanRomaji(raw) {
  let out = raw.replace(/\s+/g, ' ').trim();
  out = out.replace(/\s*-\s*/g, '-');
  out = out.replace(/\s*~\s*/g, '~');
  out = out.replace(/\s*[・･]\s*/g, '･');
  out = out.replace(/\s+([.,!?)%])/g, '$1');
  out = out.replace(/\(\s+/g, '(');
  out = out.replace(/(^|[\s(~-])(\p{L})/gu, (_m, pre, ch) => pre + ch.toUpperCase());
  return out;
}

const { data: songs, error } = await supabase
  .from('songs')
  .select('id, title, title_english')
  .or('title_english.is.null,title_english.eq.');
if (error) {
  console.error('Failed to load songs:', error.message);
  process.exit(1);
}

const candidates = (songs ?? []).filter((s) => JAPANESE_RE.test(s.title));
console.log(
  `${songs?.length ?? 0} songs missing title_english; ${candidates.length} contain Japanese characters and will be romanized.`
);

let updated = 0;
let errors = 0;

for (const song of candidates) {
  try {
    const romaji = cleanRomaji(await kuroshiro.convert(song.title, { to: 'romaji', mode: 'spaced' }));
    const { error: updateError } = await supabase
      .from('songs')
      .update({ title_english: romaji })
      .eq('id', song.id);
    if (updateError) {
      console.error(`Failed to update "${song.title}": ${updateError.message}`);
      errors++;
      continue;
    }
    updated++;
  } catch (err) {
    console.error(`Failed to romanize "${song.title}": ${err.message}`);
    errors++;
  }
}

console.log(`\nDone. Romanized and updated: ${updated}, errors: ${errors}.`);
console.log('These are automated romanizations -- spot-check them, especially stylized titles.');

const { error: syncError } = await supabase.from('catalog_syncs').insert({});
if (syncError) console.error(`Failed to record catalog sync timestamp: ${syncError.message}`);
