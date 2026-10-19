/** @see ../docs/decisions/released-stage-parity-2026-10-20.md
 * @see ../docs/modules/reviews/subject-aware-guidance.md#data-contract
 * Public allowlist shared by the browser writer and the operator repair.
 * Private guide refs/excerpts, review labels and neighboring stages are deliberately excluded.
 */
export function projectGuidanceReveal(stage) {
  return {
    title: stage.title,
    expected: stage.expected,
    rows: (stage.rows ?? []).map(({ label, value, explanation }) => ({
      ...(label === undefined ? {} : { label }), value,
      ...(explanation === undefined ? {} : { explanation }),
    })),
    role: stage.role ?? 'plain',
    why: stage.why ?? '',
    answer: stage.role === 'answer' ? stage.answer ?? '' : '',
    verification: stage.role === 'answer' ? (stage.verification ?? []).map(({ label, value }) => ({
      ...(label === undefined ? {} : { label }), value,
    })) : [],
    sourceLabel: stage.source.label,
  }
}

/** Compare Firestore map snapshots independent of their key insertion order. */
export function sameGuidanceRevealContent(left, right) {
  const stable = (value) => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
      : value
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right))
}
