export type Grade = 'MAX' | 'MAX-' | 'AAA' | 'AA' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | '—';

// DJ Level thresholds, as a fraction of max EX score (note_count * 2).
// MAX- is the top half of AAA: 17/18 of max or better, short of MAX.
const THRESHOLDS: [number, Grade][] = [
  [17 / 18, 'MAX-'],
  [8 / 9, 'AAA'],
  [7 / 9, 'AA'],
  [6 / 9, 'A'],
  [5 / 9, 'B'],
  [4 / 9, 'C'],
  [3 / 9, 'D'],
  [2 / 9, 'E'],
];

export function computeGrade(exScore: number | null, noteCount: number | null): Grade {
  if (exScore == null || noteCount == null || noteCount === 0) return '—';
  const maxScore = noteCount * 2;
  if (exScore >= maxScore) return 'MAX';
  const ratio = exScore / maxScore;
  for (const [threshold, grade] of THRESHOLDS) {
    if (ratio >= threshold) return grade;
  }
  return 'F';
}

export const CLEAR_LAMPS = [
  'FAILED',
  'ASSIST_CLEAR',
  'EASY_CLEAR',
  'CLEAR',
  'HARD_CLEAR',
  'EX_HARD_CLEAR',
  'FULL_COMBO',
] as const;

export type ClearLamp = (typeof CLEAR_LAMPS)[number];

export const LAMP_LABELS: Record<ClearLamp, string> = {
  FAILED: 'Failed',
  ASSIST_CLEAR: 'Assist Clear',
  EASY_CLEAR: 'Easy Clear',
  CLEAR: 'Clear',
  HARD_CLEAR: 'Hard Clear',
  EX_HARD_CLEAR: 'EX Hard Clear',
  FULL_COMBO: 'Full Combo',
};

// In-game lamp colors. FULL_COMBO also has a rainbow fill (LAMP_FILLS), and
// the light colors need dark text on top (LAMP_DARK_TEXT).
export const LAMP_COLORS: Record<ClearLamp, string> = {
  FAILED: '#E0565B',
  ASSIST_CLEAR: '#A77BFF',
  EASY_CLEAR: '#8EE05A',
  CLEAR: '#4FA8FF',
  HARD_CLEAR: '#F2F2F2',
  EX_HARD_CLEAR: '#FFD84D',
  FULL_COMBO: '#7FE8FF',
};
export const LAMP_FILLS: Partial<Record<ClearLamp, string>> = {
  FULL_COMBO: 'linear-gradient(135deg, #FF8A8A 0%, #FFD36E 25%, #9BF59B 50%, #7FD8FF 75%, #C59BFF 100%)',
};
export const LAMP_DARK_TEXT = new Set<ClearLamp>(['EASY_CLEAR', 'HARD_CLEAR', 'EX_HARD_CLEAR', 'FULL_COMBO']);
