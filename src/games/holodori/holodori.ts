// hololive Dreams ("Holodori") game rules and colors, matched to the game's UI.

export const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD', 'EXPERT'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  EASY: 'Easy', NORMAL: 'Normal', HARD: 'Hard', EXPERT: 'Expert',
};

// Sampled from the in-game difficulty selector. These are light pastels: use
// them as text on the dark theme or as fills with dark text -- white text on
// them is unreadable (under 3:1 contrast).
export const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  EASY: '#4FDB95', NORMAL: '#FFBB54', HARD: '#FD93B6', EXPERT: '#9A93FF',
};

// Credited groups/units (not individual members), left out of the Member
// filter. Names can't be told apart from people by pattern (e.g.
// "subachocolunatan", "SorAZ"), so add new ones here as songs are added.
export const GROUP_NAMES = new Set([
  'AyaFubuMi',
  'Blue Journey',
  'FUWAMOCO',
  'hololive 1st Generation',
  'hololive English -Advent-',
  'hololive English -Myth-',
  'hololive English -Promise-',
  'hololive IDOL PROJECT',
  'hololive Indonesia 1st Generation',
  'hololive Indonesia 2nd Generation',
  'hololive Indonesia 3rd Generation',
  'ReGLOSS',
  'Secret Society holoX',
  'Shiranui Construction',
  'SorAZ',
  'subachocolunatan',
]);

// Low to high, matching the database enum order.
export const CLEAR_LAMPS = ['CLEAR', 'FULL_COMBO', 'ALL_PERFECT'] as const;
export type ClearLamp = (typeof CLEAR_LAMPS)[number];

export const CLEAR_LAMP_LABELS: Record<ClearLamp, string> = {
  CLEAR: 'Clear', FULL_COMBO: 'Full Combo', ALL_PERFECT: 'All Perfect',
};

// The game doesn't publish grade cutoffs; these are the owner's approximations
// (same for every chart). S+ starts at 1,250,000, S+2 at 1,500,000 and S+3 at
// 2,000,000. Scores have no maximum, so above S+3 S+N continues in the same
// +500,000 steps. Edit here to correct them -- grades are derived at display
// time, never stored.
const GRADE_CUTOFFS: [number, string][] = [
  [2_000_000, 'S+3'],
  [1_500_000, 'S+2'],
  [1_250_000, 'S+'],
  [1_000_000, 'S'],
  [650_000, 'A'],
  [400_000, 'B'],
  [150_000, 'C'],
  [100_000, 'D'],
];
const S_PLUS_STEP = 500_000;

/** Grade for a score ("S+2", "A", ...), or null below the lowest cutoff / no score. */
export function computeGrade(score: number | null | undefined): string | null {
  if (score == null) return null;
  if (score >= 2_000_000) return `S+${3 + Math.floor((score - 2_000_000) / S_PLUS_STEP)}`;
  return GRADE_CUTOFFS.find(([min]) => score >= min)?.[1] ?? null;
}

// Letter fills for the grade badges, sampled from the in-game "High-score"
// badges: each letter has a lighter band over its top half, and S / every S+N
// share one diagonal pastel gradient (yellow -> pink -> violet -> blue/cyan).
const GRADE_FILLS: Record<string, string> = {
  D: 'linear-gradient(180deg, #8AD2FF 0 46%, #57ABFF 54%)',
  C: 'linear-gradient(180deg, #C4EA5E 0 46%, #91DB1D 54%)',
  B: 'linear-gradient(180deg, #FFD65E 0 46%, #F9BD00 54%)',
  A: 'linear-gradient(180deg, #FFA3DC 0 46%, #F978C5 54%)',
};
const S_FILL = 'linear-gradient(155deg, #FFE46B 8%, #FFC7A0 30%, #FAABCD 48%, #C58CFF 68%, #8FA6FF 84%, #70E0F0 100%)';

/** CSS background for a grade's letter fill (used with background-clip: text). */
export function gradeFill(grade: string): string {
  return grade.startsWith('S') ? S_FILL : GRADE_FILLS[grade] ?? '#fff';
}

/**
 * Jacket image URL for a link pasted on the song form: a YouTube video link
 * becomes that video's thumbnail, any other http(s) URL is used as is.
 * Returns null when the text isn't a URL; plain http image links are
 * refused, since the https site would block them as mixed content.
 */
export function jacketFromLink(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let videoId: string | null = null;
  if (host === 'youtu.be') videoId = url.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    videoId = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/)?.[1] ?? null;
  }
  // mqdefault is 16:9 with no letterbox bars and exists for every video,
  // unlike maxresdefault; jackets are cropped to a square anyway.
  if (videoId && /^[\w-]{11}$/.test(videoId)) return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  return url.protocol === 'https:' ? url.href : null;
}
