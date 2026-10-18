/** Display-only typography for authored feedback, never evidence/quotes/IDs.
 * @see ../../docs/modules/reviews/review-criteria-provenance.md#readable-feedback
 * @see ../../docs/decisions/readable-review-prose-2026-10-18.md
 */
export function formatReviewProse(text?: string | null): string {
  if (typeof text !== 'string') return ''
  return formatText(text, true)
}

/** An observation may contain a literal pupil calculation; space prose, not that calculation. */
export function formatReviewObservation(text?: string | null): string {
  if (typeof text !== 'string') return ''
  return formatText(text, false)
}

function formatText(text: string, arithmetic: boolean): string {
  // Do not rewrite links, addresses or literal/code fragments embedded in prose.
  return text.split(/(https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|`[^`]*`|№\s*\d+(?::\s*)?)/gi).map((part, index) => {
    if (index % 2) return part.startsWith('№') ? part.replace(/№\s*/, '№ ').replace(/:\s*$/, ': ') : part
    const prose = part
      .replace(/([а-яё])(\d)/gi, '$1 $2')
      .replace(/(\d)([а-яё])/g, '$1 $2')
      .replace(/№(?=\d)/g, '№ ')
      .replace(/([,;:!?])(?=[а-яёa-z])/gi, '$1 ')
      .replace(/([а-яё][,;:!?])(?=\d)/gi, '$1 ')
    return arithmetic ? prose.replace(/(?:\b[a-z]|\d+(?:[.,]\d+)?)(?:\s*[×÷+−=:]\s*(?:\d+(?:[.,]\d+)?|[a-z]\b|\.{3}|…))+/gi, (expression) =>
      /[×÷+−=]/.test(expression) ? expression.replace(/\s*([×÷+−=:])\s*/g, ' $1 ') : expression) : prose
  }).join('')
}

/** Reject malformed newly authored feedback; callers retain exact source data.
 * Same rules as the legacy display adapter; no network/model calls.
 * @see ../../docs/modules/reviews/review-criteria-provenance.md#readable-feedback
 */
type ProseFields = { [field: string]: true | 'observation' | ProseFields }
const reviewFields: ProseFields = {
  studentFeedback: { title: true, confirmed: true, focus: true, question: true },
  summary: true, nextStep: true,
  items: { label: true, observed: 'observation', note: true },
  requirementChecks: { action: true, explanation: true, evidence: { observation: 'observation' } },
  assessmentBasis: { requirement: true, observed: 'observation', comparison: true, limitation: true,
    disputedRequirements: { action: true, uncertainty: true } },
  mathReasoning: { observed: 'observation', minimumNeeded: true },
  workCoverage: { note: true },
  sourceAnalysis: { topic: true, observed: 'observation', quality: true, limitation: true, nextStep: true },
}
const guideFields: ProseFields = {
  overview: true, boundary: true, depthReason: true,
  stages: { title: true, expected: true, why: true, hintPreview: true, revealPreview: true, answer: true,
    rows: { label: true, value: true, explanation: true }, verification: { label: true, value: true } },
}
function proseErrors(value: unknown, fields: ProseFields, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => proseErrors(item, fields, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(fields).flatMap(([key, rule]) => {
    const text = (value as Record<string, unknown>)[key]
    const name = path ? `${path}.${key}` : key
    if (typeof rule === 'object') return proseErrors(text, rule, name)
    if (typeof text !== 'string') return []
    const formatted = rule === 'observation' ? formatReviewObservation(text) : formatReviewProse(text)
    return formatted === text ? [] : [`${name}: нужны читаемые пробелы. Предлагаемая запись: ${formatted}`]
  })
}
export function reviewProseErrors(review: unknown): string[] {
  return proseErrors(review, reviewFields)
}
/** Source quotes, IDs and historic attempts are deliberately outside these authored fields. */
export function parentGuideProseErrors(guide: unknown): string[] {
  return proseErrors(guide, guideFields, 'parentGuide')
}
/** Authored reading aids and clarification questions, never the teacher's original text. */
export function taskSupportProseErrors(task: unknown): string[] {
  return proseErrors(task, {
    support: { skill: true, facts: { label: true, value: true }, find: true, firstQuestion: true },
    materialRequest: { question: true, photoPrompt: true, resolvedTopic: true },
  })
}
