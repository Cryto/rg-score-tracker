import type { GameDefinition } from '../types';

// Placeholder: no database or score pages yet. Doubles as the smallest
// example of a game folder.
const game: GameDefinition = {
  id: 'djmax',
  name: 'DJMAX Respect V',
  subtitle: 'Coming soon',
  route: '/djmax',
  order: 30,
  picture: 'https://cdn.cloudflare.steamstatic.com/steam/apps/960170/capsule_616x353.jpg',
  comingSoon: true,
};

export default game;
