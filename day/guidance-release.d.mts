/** @see ../docs/modules/reviews/subject-aware-guidance.md#data-contract */
export type GuidanceReveal = {
  title: string; expected: string;
  rows: { label?: string; value: string; explanation?: string }[];
  role: 'plain' | 'given' | 'relations' | 'calculation' | 'solution' | 'answer';
  why: string; answer: string; verification: { label?: string; value: string }[]; sourceLabel: string;
}
export function projectGuidanceReveal(stage: Record<string, any>): GuidanceReveal
export function sameGuidanceRevealContent(left: unknown, right: unknown): boolean
