/** Display-only typography for authored feedback, never evidence/quotes/IDs.
 * @see ../../docs/modules/reviews/review-criteria-provenance.md#readable-feedback
 * @see ../../docs/decisions/readable-review-prose-2026-10-18.md
 */
export function formatReviewProse(text: string): string {
  // Do not rewrite links, addresses or literal/code fragments embedded in prose.
  return text.split(/(https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|`[^`]*`|№\s*\d+(?::\s*)?)/gi).map((part, index) => {
    if (index % 2) return part.startsWith('№') ? part.replace(/№\s*/, '№ ').replace(/:\s*$/, ': ') : part
    return part
      .replace(/([а-яё])(\d)/gi, '$1 $2')
      .replace(/(\d)([а-яё])/g, '$1 $2')
      .replace(/№(?=\d)/g, '№ ')
      .replace(/([,;:!?])(?=[а-яёa-z])/gi, '$1 ')
      .replace(/([а-яё][,;:!?])(?=\d)/gi, '$1 ')
      .replace(/\d+(?:[.,]\d+)?(?:\s*[×÷+−=:]\s*\d+(?:[.,]\d+)?)+/g, (expression) =>
        /[×÷+−=]/.test(expression) ? expression.replace(/\s*([×÷+−=:])\s*/g, ' $1 ') : expression)
  }).join('')
}

/** Reject malformed newly authored feedback; callers retain exact source data.
 * Same rules as the legacy display adapter; no network/model calls.
 * @see ../../docs/modules/reviews/review-criteria-provenance.md#readable-feedback
 */
export function reviewProseErrors(review: { studentFeedback?: Partial<Record<'title' | 'confirmed' | 'focus' | 'question', string>> }): string[] {
  return (['title', 'confirmed', 'focus', 'question'] as const).flatMap((key) => {
    const text = review.studentFeedback?.[key]
    if (typeof text !== 'string') return []
    const formatted = formatReviewProse(text)
    return formatted === text ? [] : [`studentFeedback.${key}: нужны читаемые пробелы. Предлагаемая запись: ${formatted}`]
  })
}
