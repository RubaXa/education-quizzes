/** Select only from a caller-authorized list of verified lessons; this does not establish mastery.
 * @see ../docs/modules/assessments/olympiad-preparation.md#подбор-и-образовательный-цикл */
export function recommendLesson({ lessons, completedLessonIds = [], parentChoice, difficultyTopicId } = {}) {
  if (!Array.isArray(lessons) || !Array.isArray(completedLessonIds)) throw new Error('Invalid recommendation input')
  const seen = new Set(completedLessonIds)
  const available = lessons.filter(lesson => lesson && typeof lesson.id === 'string' && typeof lesson.topicId === 'string' && lesson.verified === true && lesson.available === true)
  const eligible = available.filter(lesson => !seen.has(lesson.id))
  const choice = parentChoice && parentChoice.active === true && parentChoice.fulfilled !== true ? parentChoice : undefined
  if (choice) {
    if (!['lesson', 'topic'].includes(choice.kind) || typeof choice.id !== 'string' || !choice.id) throw new Error('Invalid parent choice')
    const match = choice.kind === 'lesson' ? available.find(lesson => lesson.id === choice.id) : (eligible.find(lesson => lesson.topicId === choice.id) ?? available.find(lesson => lesson.topicId === choice.id))
    return match ? { state: 'ready', lessonId: match.id, reason: 'parent-choice' } : { state: 'waiting', reason: 'parent-choice-unavailable' }
  }
  if (typeof difficultyTopicId === 'string' && difficultyTopicId) {
    const match = eligible.find(lesson => lesson.topicId === difficultyTopicId)
    if (match) return { state: 'ready', lessonId: match.id, reason: 'follow-up' }
  }
  return eligible.length ? { state: 'ready', lessonId: eligible[0].id, reason: 'next-available' } : { state: 'waiting', reason: 'no-verified-lesson' }
}
