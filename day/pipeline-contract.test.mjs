import { describe, expect, it } from 'vitest'
import { assertPublishedPageAligned, assertSourceAligned, sourcePlanFingerprint, textbookRefError } from './pipeline-contract.mjs'
import { assertWeekendWorkRetention } from './dashboard-index.mjs'
import { mergeFamilyAssignments } from './family-assignment.mjs'

const snapshot = { complete: true, date: '2026-10-15', assignments: [{ sourceItemId: '42', subject_name: 'Математика', detailStatus: 'loaded',
  homeworkEntries: [{ id: '99', description: 'Решить № 4.' }] }] }
const source = { targetDate: '2026-10-15', subjects: [{ tasks: [{ id: 'mesh-99', meshText: 'Решить № 4.' }] }] }

describe('диагностика ссылки на семейную страницу', () => {
  it('называет точное поле, полученное значение и допустимый ID', () => {
    const path = 'mesh-99.parentGuide.stages.evidence.source.ref'
    expect(textbookRefError('book:115#exercise-225', ['book:115'], { path }))
      .toContain(`${path}: получено "book:115#exercise-225"; нужна назначенная страница book:115`)
    expect(textbookRefError(undefined, [], { path })).toContain('taskPages пуст')
    expect(textbookRefError('book:115', ['book:115'], { path })).toBeNull()
  })
  it('сохраняет прежний контракт суффикса только для инструкции', () => {
    expect(textbookRefError('book:115#exercise-225', ['book:115'], { exact: false })).toBeNull()
    expect(textbookRefError('other-book:115', ['book:115'], { exact: false })).not.toBeNull()
    expect(textbookRefError(115, ['book:115'])).not.toBeNull()
  })
})

describe('барьер публикации плана', () => {
  it('останавливает выпуск при новом ДЗ в МЭШ без обновления источника', () => {
    expect(() => assertSourceAligned({ ...source, subjects: [] }, snapshot)).toThrow(/mesh-99/)
  })
  it('останавливает выпуск при неполном снимке', () => {
    expect(() => assertSourceAligned(source, { ...snapshot, complete: false })).toThrow(/полный снимок/)
  })
  it('разрешает точный план и связывает публикацию с его отпечатком', () => {
    expect(assertSourceAligned(source, snapshot)).toMatchObject({ legacy: false, count: 1 })
    const page = { kind: 'student', targetDate: source.targetDate, sourcePlanFingerprint: sourcePlanFingerprint(source), subjects: source.subjects }
    expect(() => assertPublishedPageAligned(source, page, 'student')).not.toThrow()
    expect(() => assertPublishedPageAligned({ ...source, subjects: [] }, page, 'student')).toThrow(/отстаёт/)
    expect(() => assertPublishedPageAligned(source, { ...page, subjects: [{ tasks: [] }] }, 'student')).toThrow(/потеряла/)
  })
  it('сохраняет source-only состояние в отпечатке и требует точную запись МЭШ при повторной сверке', () => {
    const sourceOnly = { ...source, subjects: [{ tasks: [{ id: 'mesh-99', meshText: 'Решить № 4.', detail: 'Решить № 4.',
      kind: 'check', instructionStatus: { state: 'needs-review' },
      materialStatus: { state: 'teacher-attachment-needed', message: 'Файл ещё не сопоставлен.' }, sourceOnly: true }] }] }
    const page = { kind: 'student', targetDate: sourceOnly.targetDate,
      sourcePlanFingerprint: sourcePlanFingerprint(sourceOnly), subjects: structuredClone(sourceOnly.subjects) }
    expect(() => assertSourceAligned(sourceOnly, snapshot)).not.toThrow()
    expect(() => assertPublishedPageAligned(sourceOnly, page, 'student')).not.toThrow()
    page.subjects[0].tasks[0].parentGuide = { stages: [{ id: 'old', answer: 'private' }] }
    expect(() => assertPublishedPageAligned(sourceOnly, page, 'student')).toThrow(/недопустимые поля/)
    delete page.subjects[0].tasks[0].parentGuide
    page.subjects[0].tasks[0].sourceOnly = false
    expect(() => assertPublishedPageAligned(sourceOnly, page, 'student')).toThrow(/недопустимые поля/)
    expect(() => assertSourceAligned({ ...sourceOnly, subjects: [{ tasks: [{ ...sourceOnly.subjects[0].tasks[0], meshText: 'Решить № 5.' }] }] }, snapshot)).toThrow(/не содержит актуальную запись/)
  })
  it('принимает только каноническое семейное задание поверх точного MESH fingerprint', () => {
    const plan = { targetDate: '2026-10-23', subjects: [{ id: 'russian', name: 'Русский язык', icon: '✍', tasks: [{ id: 'mesh-1', title: 'Упр. 1', detail: 'Упр. 1', kind: 'written', status: 'unknown', source: 'МЭШ', meshText: 'Упр. 1' }] }] }
    const assignment = { id: 'family-russian-essay-2026-10-23', familyId: 'family', childId: 'child', subjectId: 'russian',
      sourceSystem: 'family', sourceId: 'family-russian-essay-2026-10-23', sourceRevision: 1, dayProjectionVersion: 1, dueDate: plan.targetDate,
      title: 'Подготовка к сочинению', originalText: 'Подготовка по просьбе родителя.', steps: ['Планируй'],
      submission: { buttonLabel: 'Прикрепить', lead: 'Работа для отзыва.', photo: 'Все страницы.' }, publication: 'active', evidence: 'photo', materialIds: [] }
    const page = mergeFamilyAssignments({ kind: 'student', familyId: 'family', childId: 'child', targetDate: plan.targetDate,
      sourcePlanFingerprint: sourcePlanFingerprint(plan), subjects: structuredClone(plan.subjects), taskIds: ['mesh-1'] }, [assignment])
    expect(() => assertPublishedPageAligned(plan, page, 'student', [assignment])).not.toThrow()
    expect(() => assertPublishedPageAligned(plan, page, 'student')).toThrow(/каноническими семейными заданиями/)
    page.subjects[0].tasks.find((item) => item.id === assignment.id).detail = 'Выдуманный текст'
    expect(() => assertPublishedPageAligned(plan, page, 'student', [assignment])).toThrow(/каноническими семейными заданиями/)
    page.subjects[0].tasks.find((item) => item.id === assignment.id).detail = assignment.originalText
    page.subjects[0].tasks.find((item) => item.id === assignment.id).parentGuide = { stages: ['private'] }
    expect(() => assertPublishedPageAligned(plan, page, 'student', [assignment])).toThrow(/каноническими семейными заданиями/)
  })
  it('не принимает потерянный пункт второго варианта даже с верным отпечатком', () => {
    const plan = { targetDate: '2026-10-15', subjects: [{ id: 'math', tasks: [{ id: 'mesh-1', kind: 'check',
      practiceVariants: [{ id: 'mesh-1-v1', title: 'Вариант 1' }, { id: 'mesh-1-v2', title: 'Вариант 2' }],
      problems: [{ id: 'mesh-1-p-v1-1', variantId: 'mesh-1-v1', number: 1 },
        { id: 'mesh-1-p-v2-1', variantId: 'mesh-1-v2', number: 1 }],
    }] }] }
    const page = { kind: 'student', targetDate: plan.targetDate, sourcePlanFingerprint: sourcePlanFingerprint(plan),
      subjects: structuredClone(plan.subjects) }
    expect(() => assertPublishedPageAligned(plan, page, 'student')).not.toThrow()
    page.subjects[0].tasks[0].problems.pop()
    expect(() => assertPublishedPageAligned(plan, page, 'student')).toThrow(/вариант или номер/)
  })
  it('не даёт молча убрать выходную карточку', () => {
    const previous = [{ lessonDate: '2026-10-15', taskIds: ['mesh-99'] }]
    expect(() => assertWeekendWorkRetention(previous, [])).toThrow(/исчезла/)
    expect(() => assertWeekendWorkRetention(previous, [], [{ lessonDate: '2026-10-15', taskIds: ['mesh-99'], reason: 'Задание отменено в МЭШ.' }])).not.toThrow()
  })
})
