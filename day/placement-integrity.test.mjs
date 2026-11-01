import { describe, expect, it } from 'vitest'
import { assertAssignmentLinksExist, placementIntegrityErrors } from './placement-integrity.mjs'

const a = 'a'.repeat(32), b = 'b'.repeat(32)
const page = () => ({ schemaVersion: 1, kind: 'parent', date: '2026-10-12', targetDate: '2026-10-13', boardToken: 'parent-board', studentToken: 'student', familyId: 'family', childId: 'child', subjects: [{ id: 'history', tasks: [{ id: 'mesh-7', title: 'Читать', kind: 'read', status: 'unknown', testToken: a }] }],
  testPlacements: [{ subjectId: 'history', taskId: 'mesh-7', token: a }], materialLinks: { 'mesh-7': [] }, taskPageRefs: { 'mesh-7': [] } })

function fakeDb(paths) {
  return { doc: (path) => ({ get: async () => ({ exists: path in paths, data: () => paths[path] }) }) }
}
const assignment = (owner = {}) => ({ testId: 'test-1', title: 'Тест', subject: 'История', status: 'open', questions: [{ id: 'q1', prompt: 'Вопрос' }], ...owner })
const boardEntry = { testId: 'test-1' }

describe('целостность опубликованного дня', () => {
  it('останавливает выпуск, если после слияния остались старая и новая привязки к одному заданию', () => {
    const broken = page(); broken.testPlacements.unshift({ subjectId: 'history', taskId: 'mesh-7', token: b })
    expect(placementIntegrityErrors(broken).join(' ')).toMatch(/Два теста привязаны|не совпадает/)
  })
  it('останавливает выпуск при ссылке на отсутствующий документ теста', async () => {
    const db = fakeDb({ [`dashboard/parent-board/assignments/${a}`]: boardEntry })
    await expect(assertAssignmentLinksExist(db, page())).rejects.toThrow(/отсутствует/)
  })
  it('останавливает выпуск при чужой семейной связи', async () => {
    const db = fakeDb({ [`assignments/${a}`]: assignment({ familyId: 'other', childId: 'child' }), [`dashboard/parent-board/assignments/${a}`]: boardEntry })
    await expect(assertAssignmentLinksExist(db, page())).rejects.toThrow(/другой семьёй/)
  })
  it('принимает согласованные узлы и legacy-тест без поля семьи', async () => {
    const db = fakeDb({ [`assignments/${a}`]: assignment(), [`dashboard/parent-board/assignments/${a}`]: boardEntry })
    await expect(assertAssignmentLinksExist(db, page())).resolves.toBeUndefined()
  })
  it('разрешает архивные ссылки, но требует страницу для активного задания с textbook-page-linked', () => {
    const archived = page(); archived.materialLinks['mesh-old'] = []
    expect(placementIntegrityErrors(archived)).toEqual([])
    archived.subjects[0].tasks[0].materialStatus = { state: 'textbook-page-linked' }
    expect(placementIntegrityErrors(archived).join(' ')).toMatch(/нет заявленной страницы/)
  })
})

it('keeps the external platform task separate from its optional supplementary test', () => {
 const p=page();const task=p.subjects[0].tasks[0];delete task.testToken;task.kind='check';task.outputKind='platform-result'
 p.testPlacements=[{token:a,subjectId:'history',relatedTaskId:task.id,optional:true}]
 expect(placementIntegrityErrors(p)).toEqual([])
 expect(placementIntegrityErrors({...p,testPlacements:[{...p.testPlacements[0],optional:false}]}).some(e=>e.includes('optional'))).toBe(true)
 expect(placementIntegrityErrors({...p,testPlacements:[{...p.testPlacements[0],relatedTaskId:'missing'}]}).some(e=>e.includes('optional'))).toBe(true)
})
