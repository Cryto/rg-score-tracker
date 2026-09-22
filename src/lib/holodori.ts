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
