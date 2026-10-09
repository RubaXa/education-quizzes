export function assertOpenAssignment<T extends { status?: string }>(assignment: T | undefined): asserts assignment is T {
  if (!assignment) throw new Error('Ссылка на тест больше не доступна. Ответ не сохранён.')
  if (assignment.status !== 'open') throw new Error('Тест уже закрыт. Ответ не сохранён.')
}
