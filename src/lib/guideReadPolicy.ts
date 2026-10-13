/** Keep the guide subscription aligned with the subject card's visible state.
 * @see ../../docs/product/day-page.md#completed-subjects */
export function isSubjectExpanded(subjectId: string, done: boolean, choices: Record<string, boolean>): boolean {
  return choices[subjectId] ?? !done
}

type GuideTask = { id: string; problems?: { id: string }[] }
type GuideSubject = { id: string; tasks: GuideTask[] }

/** Only visible task cards need private parent guides. Include each problem's own guide. */
export function visibleGuideTaskIds<T extends GuideSubject>(subjects: T[], choices: Record<string, boolean>, isDone: (subject: T) => boolean): string[] {
  return [...new Set(subjects.filter((subject) => isSubjectExpanded(subject.id, isDone(subject), choices))
    .flatMap((subject) => subject.tasks.flatMap((task) => [task.id, ...(task.problems ?? []).map((problem) => problem.id)])))]
}
