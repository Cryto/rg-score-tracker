// Builds db/holodori/songs.json from hololive Dreams' official music pages
// (https://www.hololive-dreams.com/en/music and /music/). Songs are joined
// across the EN and JP pages by their jacket image's microCMS asset id.
// Jackets are linked (jacket_url on the official CDN), not self-hosted.
//
// Usage: node db/holodori/fetch-official-songs.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'songs.json');
const EN_URL = 'https://www.hololive-dreams.com/en/music';
const JP_URL = 'https://www.hololive-dreams.com/music/';

const decode = (s) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .trim();

function parse(html) {
  // Category headings ("Original Songs" / "Cover Songs") and song cards, in document order.
  const tokens = html.matchAll(/<h3 class="Music__category__title"[^>]*>([\s\S]*?)<\/h3>|<section class="Music__item"[^>]*>([\s\S]*?)<\/section>/g);
  let category = null;
  const out = [];
  for (const t of tokens) {
    if (t[1] !== undefined) { category = decode(t[1]); continue; }
    const body = t[2];
    const credits = [...body.matchAll(/class="Music__item__label"[^>]*>([\s\S]*?)<\/span>\s*<span class="Music__item__value"[^>]*>([\s\S]*?)<\/span>/g)]
      .map((m) => [decode(m[1]).replace(/[:：]$/, ''), decode(m[2])]);
    const img = body.match(/<img[^>]*src="([^"]+)"/)?.[1] ?? '';
    out.push({
      category,
      title: decode(body.match(/class="Music__item__title"[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? ''),
      unit: decode(body.match(/class="Music__item__unit"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''),
      credits: Object.fromEntries(credits),
      assetId: img.match(/assets\/[0-9a-f]+\/([0-9a-f]+)\//)?.[1] ?? null,
      jacket: decode(img).split('?')[0],
    });
  }
  return out;
}

async function fetchPage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const [en, jp] = (await Promise.all([fetchPage(EN_URL), fetchPage(JP_URL)])).map(parse);
if (!en.length || !jp.length) throw new Error('No songs parsed -- the official page markup may have changed.');
const jpByAsset = new Map(jp.map((j) => [j.assetId, j]));

const songs = en.map((e, i) => {
  const j = jpByAsset.get(e.assetId);
  return {
    order: i + 1,
    category: /cover/i.test(e.category) ? 'cover' : 'original',
    title_en: e.title,
    title_jp: j?.title ?? null,
    artist_en: e.unit,
    artist_jp: j?.unit ?? null,
    lyrics_en: e.credits['Lyrics by'] ?? null,
    music_en: e.credits['Music by'] ?? null,
    // The official site lists no arrangement credit for cover songs.
    arrangement_en: e.credits['Arrangement by'] ?? null,
    lyrics_jp: j?.credits['作詞'] ?? null,
    music_jp: j?.credits['作曲'] ?? null,
    arrangement_jp: j?.credits['編曲'] ?? null,
    jacket_asset_id: e.assetId,
    jacket_url: e.jacket,
  };
});

fs.writeFileSync(OUT, JSON.stringify(songs, null, 2) + '\n');
const unmatched = songs.filter((s) => !s.title_jp).map((s) => s.title_en);
const counts = songs.reduce((a, s) => ((a[s.category] = (a[s.category] ?? 0) + 1), a), {});
console.log(`Wrote ${songs.length} songs (${counts.original ?? 0} original, ${counts.cover ?? 0} cover) to ${OUT}`);
if (unmatched.length) console.warn(`No JP match for ${unmatched.length}: ${unmatched.join(', ')}`);
if (jp.length !== en.length) console.warn(`EN has ${en.length} songs, JP has ${jp.length}.`);
