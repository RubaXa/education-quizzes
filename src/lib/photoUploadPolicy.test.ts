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
  it('keeps upload available for every current non-test task, independent of classification or status', () => {
    expect(pupilCanAddPhoto(english, true)).toBe(false)
    expect(pupilCanAddPhoto({ ...english, referenceDate: '2026-10-12' }, false)).toBe(false)
    expect(pupilCanAddPhoto({ ...english, kind: 'read' }, false)).toBe(true)
    expect(pupilCanAddPhoto({ ...english, kind: 'check' }, false)).toBe(true)
    expect(pupilCanAddPhoto({ ...english, kind: 'read', status: 'unknown' }, false)).toBe(true)
    expect(pupilCanAddPhoto({ ...english, kind: 'read', status: 'verified' }, false)).toBe(true)
    expect(pupilCanAddPhoto({ ...english, problems: [{ id: 'p1' }] } as DayTask, false)).toBe(false)
  })
  it('keeps a separate upload for a second written sheet after the first sheet is complete', () => {
    const ratios = { ...english, id: 'mesh-351493954', title: 'Пропорции из PDF', kind: 'written' as const }
    expect(pupilCanAddPhoto(ratios, false)).toBe(true)
    expect(pupilCanAddPhoto({ ...ratios, status: 'partial' }, false)).toBe(true)
  })
  it('lets only the learner submit evidence through the same uploader before or after material clarification', () => {
    const request = { ...english, kind:'read' as const, assessmentIntent:{state:'needs-topic' as const}, materialRequest:{id:'notes-1',state:'open' as const,question:'Какая последняя тема записана в тетради?',photoPrompt:'Пришли страницы последних записей целиком.'} }
    expect(pupilCanAddPhoto(request,false)).toBe(true)
    expect(pupilCanAddPhoto(request,true)).toBe(false)
    expect(pupilCanAddPhoto({...request,materialRequest:{...request.materialRequest,state:'resolved',resolvedTopic:'Баллада',uploadIds:['photo']}},false)).toBe(true)
  })
})
