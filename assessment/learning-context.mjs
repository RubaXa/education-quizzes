/** Public placement metadata; it never grants access to a lesson or answer key.
 * @see ../docs/modules/assessments/quizzes.md */
export function learningContext(value) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'kind' && key !== 'id')
    || !['homework', 'course', 'olympiad'].includes(value.kind)
    || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id)) {
    throw new Error('Некорректный контекст учебного материала.')
  }
  return { kind: value.kind, id: value.id }
}
