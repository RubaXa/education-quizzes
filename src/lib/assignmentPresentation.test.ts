import { describe, expect, it } from 'vitest'
import { assignmentProgress, assignmentTitle } from './assignmentPresentation'

const geometry = { id: 'geometry', title: 'Геометрия: задачи 3, 4, 6 и 7' }
const ratios = { id: 'ratios', title: 'Пропорции: решить задания из файла' }

describe('отдельные назначения МЭШ внутри одного предмета', () => {
  it('не объявляет математику готовой по четырём проверенным номерам первого листа', () => {
    const progress = assignmentProgress([geometry, ratios], (task) => task.id === 'geometry'
      ? [{ state: 'done' }, { state: 'done' }, { state: 'done' }, { state: 'done' }]
      : [{ state: 'todo' }])
    expect(progress).toEqual({ total: 2, completed: 1, complete: false, multiple: true })
    expect(assignmentTitle(geometry, 0, 2)).toBe('Задание 1 · Геометрия: задачи 3, 4, 6 и 7')
    expect(assignmentTitle(ratios, 1, 2)).toBe('Задание 2 · Пропорции: решить задания из файла')
  })
  it('не вводит дополнительный номер при одном назначении', () => {
    expect(assignmentTitle(geometry, 0, 1)).toBe(geometry.title)
  })
  it('не закрывает лист по частично проверенным пунктам', () => {
    expect(assignmentProgress([ratios], () => [{ state: 'done' }, { state: 'checking' }]).complete).toBe(false)
  })
})
