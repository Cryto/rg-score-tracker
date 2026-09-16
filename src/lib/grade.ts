export type Grade = 'AAA' | 'AA' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | '—';

// DJ Level thresholds, as a fraction of max EX score (note_count * 2).
const THRESHOLDS: [number, Grade][] = [
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
  const ratio = exScore / (noteCount * 2);
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
