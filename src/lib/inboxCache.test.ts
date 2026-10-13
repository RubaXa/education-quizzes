// @vitest-environment jsdom
// @see ../../docs/product/dashboard.md#dashboard-warm-start
import { afterEach, expect, it } from 'vitest'
import { clearCachedInbox, markCachedInboxRead, readCachedInbox, writeCachedInbox } from './inboxCache'

afterEach(() => localStorage.clear())

it('restores the last inbox per person and keeps a read receipt through a stale SDK snapshot', () => {
  const notice = { id: 'notice', familyId: 'family', childId: 'child', type: 'school_late' as const,
    entityId: 'lesson', sourceRevision: 1, createdAt: '2026-10-13T08:00:00.000Z' }
  writeCachedInbox('parent', [notice])
  expect(readCachedInbox('parent')).toHaveLength(1)
  expect(readCachedInbox('other')).toHaveLength(0)
  markCachedInboxRead('parent', ['notice'])
  const afterStale = writeCachedInbox('parent', [notice])
  expect(afterStale[0].readAt).toBeTruthy()
  clearCachedInbox('parent')
  expect(readCachedInbox('parent')).toHaveLength(0)
})
