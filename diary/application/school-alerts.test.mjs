import { describe, expect, it, vi } from 'vitest'
vi.mock('../../storage/inbox-notifications.mjs', async importOriginal => ({ ...await importOriginal(), stageFamilyNotice: vi.fn(async () => 2) }))
import { stageFamilyNotice, notificationId } from '../../storage/inbox-notifications.mjs'
import { schoolAlerts, stageSchoolAlerts, verifySchoolAlerts } from './school-alerts.mjs'
const mark = { id: 123, date: '2026-11-16', value: 2, comment: 'Нет домашней работы', is_point: true }
const snapshot = recent => ({ complete: true, profile: { children: [{}] }, marks: [{ subject_name: 'Математика', marks: [], recentMarks: recent }] })
const owner = { familyId: 'family', childId: 'child' }
describe('school homework debt is separate from verified student work', () => {
  it('includes a point absent from the numeric journal once and ignores ambiguous marks', () => {
    const source = snapshot([mark, mark, { ...mark, id: 124, comment: 'Молодец' }])
    expect(schoolAlerts(source)).toHaveLength(1)
    expect(schoolAlerts(source)[0]).toMatchObject({ sourceId: '123', kind: 'homework-debt', point: true })
    expect(schoolAlerts({ ...source, complete: false })).toEqual([])
    expect(schoolAlerts({ complete: true, marks: [{ marks: [{ ...mark, is_point: false }] }] })).toEqual([])
  })
  it('asks both roles to locate and hand in existing work, without resetting credit or asking for photos', async () => {
    await stageSchoolAlerts({}, {}, snapshot([mark]), owner)
    expect(stageFamilyNotice).toHaveBeenLastCalledWith({}, {}, expect.objectContaining({ ...owner, roles: ['parent', 'student'],
      key: 'school:child:123', data: expect.objectContaining({ type: 'school_remark', body: expect.stringContaining('Уже сохранённые фото повторно отправлять не нужно.') }) }))
  })
  it('verifies the exact inbox documents after publication and fails on a missing student notice', async () => {
    const members = ['parent', 'student'].map(role => ({ id: role, data: () => ({ role, active: true, childIds: ['child'] }) }))
    const refs = []
    const db = { collection: () => ({ get: async () => ({ docs: members }) }), doc: path => { refs.push(path); return path },
      getAll: async () => members.map(() => ({ exists: true, data: () => ({ ...owner, entityId: '123', type: 'school_remark', body: 'Нет домашней работы. Уже сохранённые фото повторно отправлять не нужно.' }) })) }
    expect(await verifySchoolAlerts(db, snapshot([mark]), owner)).toEqual({ verified: true, documents: 2 })
    expect(refs).toContain(`users/student/inbox/${notificationId('school:child:123')}`)
    db.getAll = async () => [{ exists: false, data: () => undefined }]
    await expect(verifySchoolAlerts(db, snapshot([mark]), owner)).rejects.toThrow('school_alert_readback_failed')
  })
})
