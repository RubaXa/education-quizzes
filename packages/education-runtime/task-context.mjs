/** @see ../../docs/modules/notifications/events.md */
export function taskContext(page, taskId) {
  if (!page || typeof taskId !== 'string' || !Array.isArray(page.subjects)) return null
  for (const subject of page.subjects) {
    for (const task of subject?.tasks ?? []) {
      if (task?.id === taskId) return { subject: subject.name, title: task.title }
      const problem = task?.problems?.find((item) => item?.id === taskId)
      if (problem) return { subject: subject.name, title: `№ ${problem.number}. ${problem.title}` }
    }
  }
  return null
}
