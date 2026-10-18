import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { assignmentRouteEvidence, prepareAssignmentRoute } from './assignment-routing.mjs'
import { assertSourceAligned } from './pipeline-contract.mjs'
import { buildDayDashboardIndex, assertWeekendWorkRetention } from './dashboard-index.mjs'
import { buildDaySource } from './build.mjs'
import { mergeDayPage } from './merge.mjs'

/** @see ../docs/modules/synchronization/plan-generation.md#assignment-routing */
const temporary = []
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture() {
  const text = 'Выполнить в тетрадях по спецкурсу задания из файла.'
  const task = { id: 'mesh-2', meshText: text, title: 'Комбинаторика', kind: 'written', status: 'unknown', lessonDate: '2026-10-19', originDate: '2026-10-19', dueDate: '2026-10-19',
    problems: Array.from({ length: 8 }, (_, index) => ({ id: `mesh-2-p${index + 1}`, number: index + 1, original: { text: `Условие ${index + 1}` }, parentGuide: { title: 'Закрытый разбор' } })),
    practiceVariants: [{ id: 'mesh-2-v1', title: '1', optionalByTeacher: { sourceRef: 'file:2', excerpt: 'Реши сколько получится' } }], parentGuide: { title: 'Разбор листа' } }
  const from = { targetDate: '2026-10-19', subjects: [{ id: 'math', name: 'Математика', icon: '∑', mesh: `ЦДЗ; ${text}`, tasks: [{ id: 'mesh-1', meshText: 'ЦДЗ', kind: 'check', platformResult: { state: 'completed', correct: 8, total: 8 } }, task] }],
    materialLinks: { 'mesh-2': [{ sourceType: 'teacher-attachment', title: 'Лист', url: 'https://example.org/original.pdf' }] }, evidenceDayTokens: ['earlier'], weekendSlot: { dates: ['2026-10-17', '2026-10-18'], title: 'Спецкурс', taskIds: ['mesh-2'], dueDate: '2026-10-19' } }
  const to = { targetDate: '2026-10-22', subjects: [{ id: 'math', name: 'Математика', tasks: [{ id: 'mesh-3', meshText: 'ЦДЗ 2' }] }] }
  const snapshots = Object.fromEntries(['2026-10-16', '2026-10-19', '2026-10-21', '2026-10-22'].map((date) => [date, { date, complete: true, fetchedAt: '2026-10-18T10:00:00Z', schedule: [], assignments: [] }]))
  snapshots['2026-10-19'].assignments = [{ subjectId: 1, subjectName: 'Математика', detailStatus: 'loaded', homeworkEntries: [{ id: '1', description: 'ЦДЗ' }, { id: '2', description: text }] }]
  snapshots['2026-10-19'].schedule = [{ id: 9, subject_name: 'Математика', start_at: '2026-10-19T10:30:00+03:00' }]
  snapshots['2026-10-22'].assignments = [{ subjectId: 1, subjectName: 'Математика', detailStatus: 'loaded', homeworkEntries: [{ id: '3', description: 'ЦДЗ 2' }] }]
  snapshots['2026-10-22'].schedule = [{ id: 11, subject_name: 'Специальный курс по математике', start_at: '2026-10-22T14:30:00+03:00' }]
  const links = { '2026-10-16': { student: 'old-student', parent: 'old-parent' }, '2026-10-21': { student: 'new-student', parent: 'new-parent' } }
  const request = { schemaVersion: 1, taskId: 'mesh-2', fromSourceDate: '2026-10-16', toSourceDate: '2026-10-21', targetSubject: { id: 'special', name: 'Спецкурс по математике', icon: '∑' }, targetLessonId: '11', targetLessonName: 'Специальный курс по математике', reason: 'Родитель подтвердил четверговый спецкурс.', decisionRef: 'parent:course-placement' }
  const readSnapshot = (date) => snapshots[date]
  const prepare = () => prepareAssignmentRoute(request, from, to, links, readSnapshot)
  return { from, to, snapshots, links, request, readSnapshot, prepare }
}
function context(f, result) { return { readSnapshot: f.readSnapshot, readSource: (date) => date === f.request.fromSourceDate ? result.from : result.to } }

describe('reviewed course assignment placement', () => {
  it('moves one owner, preserves every original, guide, option, result and evidence link', () => {
    const f = fixture(), result = f.prepare()
    const moved = result.to.subjects.find((subject) => subject.id === 'special').tasks[0]
    expect(moved).toEqual({ ...f.from.subjects[0].tasks[1], lessonDate: '2026-10-22', originDate: '2026-10-22', dueDate: '2026-10-22' })
    expect(result.from.subjects[0].tasks).toEqual([f.from.subjects[0].tasks[0]])
    expect(result.from.retiredTaskIds).toEqual(['mesh-2'])
    expect(result.to.evidenceDayTokens).toEqual(['old-student', 'earlier'])
    expect(result.to.weekendSlot).toMatchObject({ dates: ['2026-10-17', '2026-10-18'], taskIds: ['mesh-2'], dueDate: '2026-10-22' })
    expect(result.to.materialLinks['mesh-2']).toEqual(f.from.materialLinks['mesh-2'])
    expect(() => assertSourceAligned(result.from, f.snapshots[result.from.targetDate], context(f, result))).not.toThrow()
    expect(() => assertSourceAligned(result.to, f.snapshots[result.to.targetDate], context(f, result))).not.toThrow()
    const oldPage = { ...f.from, taskIds: ['mesh-1', 'mesh-2'] }
    expect(mergeDayPage(oldPage, result.from).subjects[0].tasks).toHaveLength(1)
    // No mutation of raw inputs or student evidence by the planning tool.
    expect(f.from.subjects[0].tasks).toHaveLength(2)
  })
  it.each(['student', 'parent'])('projects Monday CDZ, Thursday special course and weekend to the same %s target page', (role) => {
    const f = fixture(), result = f.prepare(), local = mkdtempSync(resolve(tmpdir(), 'course-routing-'))
    temporary.push(local); mkdirSync(resolve(local, 'diary'))
    for (const [date, snapshot] of Object.entries(f.snapshots)) writeFileSync(resolve(local, 'diary', `snapshot-${date}.json`), JSON.stringify(snapshot))
    for (const [date, plan] of [['2026-10-16', result.from], ['2026-10-21', result.to]]) writeFileSync(resolve(local, `day-source-${date}.json`), JSON.stringify(plan))
    writeFileSync(resolve(local, 'day-links.json'), JSON.stringify(f.links))
    const index = buildDayDashboardIndex(local, f.links, role, new Date('2026-10-18T10:00:00Z'))
    expect(index.days.find((day) => day.date === '2026-10-19').homework).toEqual([{ subject: 'Математика', text: 'ЦДЗ' }])
    expect(index.days.find((day) => day.date === '2026-10-22').homework).toContainEqual({ subject: 'Спецкурс по математике', text: result.route.meshText })
    expect(index.weekendWork).toEqual([{ dates: ['2026-10-17', '2026-10-18'], title: 'Спецкурс', taskIds: ['mesh-2'], lessonDate: '2026-10-22', dueDate: '2026-10-22', dayToken: `new-${role}` }])
    expect(() => assertWeekendWorkRetention([{ lessonDate: '2026-10-19', taskIds: ['mesh-2'] }], index.weekendWork, [{ lessonDate: '2026-10-19', taskIds: ['mesh-2'], reason: 'Перенос, не отмена' }])).not.toThrow()
    buildDaySource(local, '2026-10-16')
    const rebuilt = JSON.parse(readFileSync(resolve(local, 'day-source-2026-10-16.json')))
    expect(rebuilt.subjects.flatMap((subject) => subject.tasks).map((task) => task.id)).toEqual(['mesh-1'])
    expect(rebuilt.subjects[0].mesh).toBe('ЦДЗ')
    buildDaySource(local, '2026-10-21')
    const target = JSON.parse(readFileSync(resolve(local, 'day-source-2026-10-21.json')))
    expect(target.subjects.find((subject) => subject.id === 'special').tasks[0].id).toBe('mesh-2')
  })
  it('is idempotent and preserves an explicit earlier teacher deadline', () => {
    const f = fixture(); f.from.subjects[0].tasks[1].dueDateEvidence = { kind: 'mesh', excerpt: 'Сдать в понедельник' }
    const result = f.prepare()
    expect(result.to.weekendSlot.dueDate).toBe('2026-10-19')
    expect(prepareAssignmentRoute(f.request, result.from, result.to, f.links, f.readSnapshot)).toMatchObject({ from: result.from, to: result.to, reused: true })
  })
  it('rejects stale MESH, missing lesson, duplicated owner and one-sided placement', () => {
    const f = fixture(), result = f.prepare(), ctx = context(f, result)
    f.snapshots['2026-10-19'].assignments[0].homeworkEntries[1].description = 'Изменено'
    expect(() => assignmentRouteEvidence(result.from, ctx.readSource, ctx.readSnapshot)).toThrow(/исходник/)
    f.snapshots['2026-10-19'].assignments[0].homeworkEntries[1].description = result.route.meshText
    f.snapshots['2026-10-22'].schedule = []
    expect(() => assignmentRouteEvidence(result.from, ctx.readSource, ctx.readSnapshot)).toThrow(/урок/)
    f.snapshots['2026-10-22'].schedule = [{ id: 11, subject_name: 'Специальный курс по математике' }]
    result.from.subjects[0].tasks.push(f.from.subjects[0].tasks[1])
    expect(() => assignmentRouteEvidence(result.from, ctx.readSource, ctx.readSnapshot)).toThrow(/владельца/)
    result.from.subjects[0].tasks.pop(); result.to.assignmentRoutes = []
    expect(() => assignmentRouteEvidence(result.from, ctx.readSource, ctx.readSnapshot)).toThrow(/Обе стороны/)
  })
  it('rejects a transfer with a live quiz instead of silently damaging its placement', () => {
    const f = fixture(); f.from.subjects[0].tasks[1].testToken = 'quiz'
    expect(() => f.prepare()).toThrow(/тестового назначения/)
  })
})
