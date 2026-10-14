/** Both role dayPages are link-readable. Private task guidance lives in dayTaskGuides.
 * @see ../docs/product/subject-aware-guidance.md#release-gate */
export function publicProblem({ sourceResearch: _sourceResearch, parentGuide: _parentGuide, ...problem }) {
  return problem
}

export function publicPageSubjects(subjects) {
  return subjects.map((subject) => ({ ...subject, tasks: subject.tasks.map(({ parentGuide: _parentGuide, sourceResearch: _sourceResearch, sourceInventory: _sourceInventory, ...task }) => ({
    ...task,
    ...(task.problems ? { problems: task.problems.map(publicProblem) } : {}),
  })) }))
}
