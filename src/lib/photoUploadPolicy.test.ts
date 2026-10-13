import { describe, expect, it } from 'vitest'
import type { DayTask } from './dayStore'
import { pupilCanAddPhoto } from './photoUploadPolicy'

const english = { id: 'mesh-351062300', title: 'Упр. 3', detail: 'Упр. 3', kind: 'written', status: 'unknown', source: 'МЭШ' } as DayTask

describe('student photo upload availability', () => {
  it('remains available after partial or unassessable work and accepts follow-up photos', () => {
    expect(pupilCanAddPhoto(english, false)).toBe(true)
    expect(pupilCanAddPhoto({ ...english, status: 'partial' }, false)).toBe(true)
    expect(pupilCanAddPhoto({ ...english, status: 'needs-fix' }, false)).toBe(true)
  })
  it('uses the same entry point only for student written tasks', () => {
    expect(pupilCanAddPhoto(english, true)).toBe(false)
    expect(pupilCanAddPhoto({ ...english, referenceDate: '2026-10-12' }, false)).toBe(false)
    expect(pupilCanAddPhoto({ ...english, kind: 'read' }, false)).toBe(false)
  })
  it('keeps a separate upload for a second written sheet after the first sheet is complete', () => {
    const ratios = { ...english, id: 'mesh-351493954', title: 'Пропорции из PDF', kind: 'written' as const }
    expect(pupilCanAddPhoto(ratios, false)).toBe(true)
    expect(pupilCanAddPhoto({ ...ratios, status: 'partial' }, false)).toBe(true)
  })
})
