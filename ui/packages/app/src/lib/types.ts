export type GapStep = 1 | 2 | 3 | 4 | 5 | 6;

export const gapVar = (step: GapStep): string => `var(--space-${step})`;
