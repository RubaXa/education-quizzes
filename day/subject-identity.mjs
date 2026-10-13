/** Shared lesson identity. Keep Firestore subject IDs stable during migration.
 * @see ../docs/product/dashboard.md#schedule-homework-status */
const known = [
  [/спецкурс|специальный курс/i, 'special', 'Спецкурс по математике', '♟'],
  [/практикум/i, 'practicum', 'Практикум по решению математических задач', '∑'],
  [/математ/i, 'math', 'Математика', '∑'],
  [/русск/i, 'russian', 'Русский язык', '✍'],
  [/литератур/i, 'literature', 'Литература', '📚'],
  [/истори/i, 'history', 'История', '🏛'],
  [/англий|иностран/i, 'english', 'Английский язык', '🇬🇧'],
  [/труд|технолог/i, 'technology', 'Труд (технология)', '🛠'],
  [/биологи/i, 'biology', 'Биология', '🌿'],
  [/географ/i, 'geography', 'География', '🌍'],
]

export function lessonSubjectKey(name) {
  return known.find(([pattern]) => pattern.test(name ?? ''))?.[1] ?? null
}

export function subjectPresentation(name, sourceSubjectId) {
  const found = known.find(([pattern]) => pattern.test(name ?? ''))
  return found ? found.slice(1) : [`subject-${sourceSubjectId ?? 'other'}`, name || 'Предмет', '📘']
}
