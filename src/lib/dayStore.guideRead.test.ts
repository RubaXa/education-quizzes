import { beforeEach, describe, expect, it, vi } from 'vitest'

/** @see ../../docs/modules/reviews/subject-aware-guidance.md#parent-card */
const probe = vi.hoisted(() => ({ listeners: [] as Array<{ path: string; ids: string[] | null; emit: (value: unknown) => void; stop: ReturnType<typeof vi.fn> }> }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('./photoOutbox', () => ({ removePhotoFromOutbox: vi.fn(), resumePhotoTransfer: vi.fn(), savePhotoForTransfer: vi.fn() }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'device' } }) }))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/'), ids: null }),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  documentId: () => '__name__',
  where: (_field: string, _operator: string, ids: string[]) => ({ ids }),
  query: (ref: { path: string }, filter: { ids: string[] }) => ({ ...ref, ids: filter.ids }),
  onSnapshot: (ref: { path: string; ids: string[] | null }, emit: (value: unknown) => void) => {
    const stop = vi.fn()
    probe.listeners.push({ ...ref, emit, stop })
    return stop
  },
  getDoc: vi.fn(), getDocFromServer: vi.fn(), serverTimestamp: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(),
}))

import { watchDayTaskGuides } from './dayStore'

const snapshot = (ids: string[]) => ({ docs: ids.map((id) => ({ id, data: () => ({ guide: { overview: id } }) })) })
beforeEach(() => { probe.listeners.length = 0 })

describe('private guide subscriptions', () => {
  it('makes no query for folded subjects and subscribes only to visible task IDs', () => {
    const onChange = vi.fn()
    watchDayTaskGuides('day', onChange, vi.fn(), { taskIds: [] })
    expect(probe.listeners).toHaveLength(0)
    expect(onChange).toHaveBeenCalledWith({})

    const stop = watchDayTaskGuides('day', onChange, vi.fn(), { taskIds: ['sheet', 'problem-1'] })
    expect(probe.listeners).toHaveLength(1)
    expect(probe.listeners[0]).toMatchObject({ path: 'dayTaskGuides/day/items', ids: ['sheet', 'problem-1'] })
    probe.listeners[0].emit(snapshot(['sheet', 'problem-1']))
    expect(Object.keys(onChange.mock.lastCall![0])).toEqual(['sheet', 'problem-1'])
    stop()
    expect(probe.listeners[0].stop).toHaveBeenCalledOnce()
  })

  it('keeps the old whole-collection mode for the weekend math screen', () => {
    watchDayTaskGuides('day', vi.fn(), vi.fn())
    expect(probe.listeners[0].ids).toBeNull()
  })

  it('bounds the query when a visible worksheet has more than 30 task IDs', () => {
    const onChange = vi.fn()
    watchDayTaskGuides('day', onChange, vi.fn(), { taskIds: Array.from({ length: 31 }, (_, index) => `task-${index}`) })
    expect(probe.listeners.map((item) => item.ids?.length)).toEqual([30, 1])
    probe.listeners[0].emit(snapshot(['task-0']))
    expect(onChange).not.toHaveBeenCalled()
    probe.listeners[1].emit(snapshot(['task-30']))
    expect(Object.keys(onChange.mock.lastCall![0])).toEqual(['task-0', 'task-30'])
  })
})
