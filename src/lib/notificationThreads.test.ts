import { describe, expect, it } from 'vitest'
import { groupNotificationThreads, viewedHomeworkNoticeIds } from './notificationThreads'
import type { Notice } from './notificationThreads'

const notice = (id: string, type: Notice['type'], taskId?: string, readAt?: string): Notice => ({
  id, type, familyId: 'family', childId: 'child', entityId: taskId ?? id,
  ...(taskId ? { taskId } : {}), ...(readAt ? { readAt } : {}),
  sourceRevision: 1, createdAt: '2026-10-13T00:00:00Z',
})

describe('notification threads', () => {
  it('keeps one visible unread work thread and every source event', () => {
    const records = [
      notice('new-review', 'review_ready', 'work'), notice('started-review', 'review_started', 'work'),
      notice('hint-2', 'parent_guidance', 'work'), notice('hint-1', 'parent_guidance', 'work'),
      notice('product-2', 'product_update'), notice('product-1', 'product_update', undefined, 'seen'),
      notice('late', 'school_late', undefined, 'seen'),
    ]
    const groups = groupNotificationThreads(records)
    expect(groups).toHaveLength(4)
    expect(groups.map((group) => group.unread)).toEqual([2, 2, 1, 0])
    expect(groups[0].items.map((item) => item.id)).toEqual(['new-review', 'started-review'])
    expect(groups.flatMap((group) => group.items)).toHaveLength(records.length)
    const reductionPercent = (records.length - groups.length) / records.length * 100
    expect(reductionPercent).toBeGreaterThanOrEqual(20)
  })

  it('does not merge two children, unrelated tasks or distinct school remarks', () => {
    const first = notice('one', 'review_ready', 'task')
    const second = { ...notice('two', 'review_ready', 'task'), childId: 'other-child' }
    const third = notice('three', 'review_ready', 'other-task')
    const school = [notice('late-a', 'school_late'), notice('late-b', 'school_late')]
    expect(groupNotificationThreads([first, second, third, ...school])).toHaveLength(5)
  })

  it('acknowledges only the opened lesson for the correct child', () => {
    const news = { ...notice('new-english', 'homework_published'), date: '2026-10-13', subject: 'Иностранный (английский) язык' }
    const records = [news, { ...news, id: 'other-child', childId: 'other' },
      { ...news, id: 'other-date', date: '2026-10-14' },
      { ...news, id: 'other-subject', subject: 'Математика' },
      { ...news, id: 'old-seen', readAt: '2026-10-13T10:00:00Z' }]
    expect(viewedHomeworkNoticeIds(records, { familyId: 'family', childId: 'child',
      date: '2026-10-13', subject: 'Английский язык' })).toEqual(['new-english'])
  })
})
