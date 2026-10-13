/** A lesson subject owns N independent MESH assignments. Nested problem counts
 * describe only their own assignment. @see ../../docs/product/day-page.md#multiple-assignments */
export function assignmentProgress<T extends { id: string }>(tasks: T[], itemsFor: (task: T) => { state: string }[]) {
  const completed = tasks.filter((task) => {
    const items = itemsFor(task)
    return items.length > 0 && items.every((item) => item.state === 'done')
  }).length
  return { total: tasks.length, completed, complete: tasks.length > 0 && completed === tasks.length, multiple: tasks.length > 1 }
}

export function assignmentTitle(task: { title: string }, index: number, count: number) {
  return count > 1 ? `Задание ${index + 1} · ${task.title}` : task.title
}
