import type { GameDefinition } from '../types';

const game: GameDefinition = {
  id: 'holodori',
  name: 'Hololive Dreams',
  subtitle: 'hololive · Rhythm',
  route: '/holodori',
  order: 20,
  // The share image is 1.5 MB, so it goes through that site's own resizer
  // (only w=430 is allowed there), falling back to the original if the
  // resizer stops accepting it.
  picture: 'https://www.hololive-dreams.com/_vercel/image?url=%2Fogp.jpg&w=430&q=100',
  pictureFallback: 'https://www.hololive-dreams.com/ogp.jpg',
  supabase: {
    url: import.meta.env.PUBLIC_SUPABASE_URL_HOLODORI,
    key: import.meta.env.PUBLIC_SUPABASE_ANON_KEY_HOLODORI,
  },
  settingsLinks: [
    {
      href: '/settings/holodori/new',
      title: 'Add / Update a Score',
      description: 'Search a song, pick a difficulty, enter score and clear.',
    },
    {
      href: '/settings/holodori/song',
      title: 'Add / Edit a Song',
      description: 'Add a new song with its difficulty levels, or edit an existing one (levels, song type, members).',
    },
  ],
};

export default game;
