import type { GameDefinition } from '../types';

const game: GameDefinition = {
  id: 'iidx',
  name: 'beatmania IIDX',
  subtitle: 'Konami · Rhythm',
  route: '/iidx',
  order: 10,
  picture: 'https://p.eagate.573.jp/game/infinitas/2/img/infinitas.jpg',
  // IIDX keeps the original, unsuffixed env var names.
  supabase: { url: import.meta.env.PUBLIC_SUPABASE_URL, key: import.meta.env.PUBLIC_SUPABASE_ANON_KEY },
  settingsLinks: [
    {
      href: '/settings/new',
      title: 'Add / Update a Score',
      description: 'Search a song/chart, enter EX score, lamp, and miss count manually.',
    },
    {
      href: '/settings/import',
      title: 'Bulk Import (CSV)',
      description: 'Paste a CSV of scores, matched by song title, and import in bulk.',
    },
    {
      href: '/settings/import-json',
      title: 'Import from JSON Export',
      description: 'Upload a native score-export file, matched exactly by song ID.',
    },
    {
      href: '/settings/catalog-import',
      title: 'Catalog Import / Update (CSV)',
      description: 'Add or update songs and charts themselves — titles, levels, BPM, and more.',
    },
  ],
};

export default game;
