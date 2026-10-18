/** @see ../../docs/decisions/grade-average-ui-kit-2026-10-18.md */
/** @see ../../docs/modules/school-diary/grades.md#grade-badge */
import './GradeAverage.css'

export type GradeAverageTone = 'error' | 'attention' | 'neutral' | 'accent' | 'success'

/** Presentation bands for a stored school average, not a school/year-grade rule. */
export function gradeAverageTone(average: number, watch = false, allFives = false): GradeAverageTone {
  if (allFives) return 'success'
  if (watch) return 'attention'
  if (!Number.isFinite(average) || average < 3) return 'error'
  if (average < 4) return 'attention'
  if (average < 4.5) return 'neutral'
  if (average < 4.6) return 'accent'
  return 'success'
}

/** Shared visual primitive for school averages. It does not infer risk or calculate grades. */
export default function GradeAverage({ value, tone = 'neutral', excellent = false }: {
  value: string
  tone?: GradeAverageTone
  excellent?: boolean
}) {
  return <span className={`edu-grade-average edu-grade-average-${tone}`}>
    {value}{excellent && <span className="edu-grade-average-star" aria-hidden="true"> ✨</span>}
  </span>
}
