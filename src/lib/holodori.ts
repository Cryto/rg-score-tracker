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

// Low to high, matching the database enum order.
export const CLEAR_LAMPS = ['CLEAR', 'FULL_COMBO', 'ALL_PERFECT'] as const;
export type ClearLamp = (typeof CLEAR_LAMPS)[number];

export const CLEAR_LAMP_LABELS: Record<ClearLamp, string> = {
  CLEAR: 'Clear', FULL_COMBO: 'Full Combo', ALL_PERFECT: 'All Perfect',
};

// CSS backgrounds for the in-game clear circles (All Perfect is a rainbow).
export const CLEAR_LAMP_BACKGROUNDS: Record<ClearLamp, string> = {
  CLEAR: '#F9FF55',
  FULL_COMBO: '#FF3BC8',
  ALL_PERFECT: 'linear-gradient(135deg, #A25CFF, #5B62FF, #4CBFFF, #63E8E3, #A5FF99, #E7F3B4)',
};

// The game doesn't publish grade cutoffs; these are the owner's approximations
// (same for every chart). Scores have no maximum, so S+N continues upward in
// the same +250,000 steps observed from S to S+2. Edit here to correct them --
// grades are derived at display time, never stored.
const GRADE_CUTOFFS: [number, string][] = [
  [1_000_000, 'S'],
  [650_000, 'A'],
  [400_000, 'B'],
  [150_000, 'C'],
  [100_000, 'D'],
];
const S_PLUS_STEP = 250_000;

/** Grade for a score ("S+2", "A", ...), or null below the lowest cutoff / no score. */
export function computeGrade(score: number | null | undefined): string | null {
  if (score == null) return null;
  if (score >= 1_000_000) {
    const plus = Math.floor((score - 1_000_000) / S_PLUS_STEP);
    return plus === 0 ? 'S' : plus === 1 ? 'S+' : `S+${plus}`;
  }
  return GRADE_CUTOFFS.find(([min]) => score >= min)?.[1] ?? null;
}

// Grade badge colors sampled from the in-game "High-score" badges. S and every
// S+N share one pastel gradient.
export const GRADE_COLORS: Record<string, string> = {
  D: '#57ABFF', C: '#91DB1D', B: '#F9BD00', A: '#F978C5',
};
export const S_GRADE_BACKGROUND = 'linear-gradient(135deg, #FFE46B, #FAABCD, #A878FE, #988EF9)';
