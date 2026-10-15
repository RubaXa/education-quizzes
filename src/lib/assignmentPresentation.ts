/** A lesson subject owns N independent MESH assignments. Nested problem counts
 * describe only their own assignment. @see ../../docs/product/day-page.md#multiple-assignments */
export function assignmentProgress<T extends { id: string }>(tasks: T[], itemsFor: (task: T) => { state: string }[]) {
  const required = tasks.map(itemsFor).filter((items) => items.length > 0)
  const completed = required.filter((items) => items.every((item) => item.state === 'done')).length
  return { total: tasks.length, requiredTotal: required.length, completed, complete: required.length > 0 && completed === required.length, multiple: tasks.length > 1 }
}

export function assignmentTitle(task: { title: string }, index: number, count: number) {
  return count > 1 ? `Задание ${index + 1} · ${task.title}` : task.title
}
