// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { homeworkUpdateKey, markHomeworkUpdateSeen, wasHomeworkUpdateSeen } from './homeworkUpdateReceipt'

afterEach(() => localStorage.clear())

describe('new homework acknowledgement', () => {
  it('hides only the opened version and restores a genuinely newer change', () => {
    const first = homeworkUpdateKey('parent-token', '2026-10-13', 'Русский язык', '2026-10-12T18:00:00Z')
    const changed = homeworkUpdateKey('parent-token', '2026-10-13', 'Русский язык', '2026-10-13T08:00:00Z')
    const otherRole = homeworkUpdateKey('student-token', '2026-10-13', 'Русский язык', '2026-10-12T18:00:00Z')
    expect(wasHomeworkUpdateSeen(first)).toBe(false)
    markHomeworkUpdateSeen(first)
    expect(wasHomeworkUpdateSeen(first)).toBe(true)
    expect(wasHomeworkUpdateSeen(changed)).toBe(false)
    expect(wasHomeworkUpdateSeen(otherRole)).toBe(false)
  })
})
