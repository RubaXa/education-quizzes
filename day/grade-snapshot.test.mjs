import { describe, expect, it } from 'vitest'
import { proposeGradeSnapshot, gradeCollectionProvenance } from './grade-snapshot.mjs'

const report = 'reports/2026-10-16-education-sync/baseline.md'
const previous = { snapshot_id: 'grades:2026-10-15-period-1', observed_at: '2026-10-15', source_report: 'old',
  working_threshold: 4.8, working_threshold_status: 'conditional; not a confirmed school rule',
  subjects: [{ id: 'math', name: 'Математика', grades: [[5, 1], [4, 1]], displayed_average: 4.5, app_more_fives: 9 }] }
const mesh = { complete: true, fetchedAt: '2026-10-16T06:30:00.000Z',
  marks: [{ subject_name: 'Математика', count: 3, average: 4.67,
    marks: [{ value: 5, weight: 1 }, { value: 4, weight: 1 }, { value: 5, weight: 1 }] }] }

describe('штатное обновление среза оценок', () => {
  it('adds a known subject on its first mark in the current period without inheriting old grades', () => {
    const period = { start: '2026-11-23', end: '2027-02-21', index: 2, title: 'Период 2' }
    const old = { ...previous, period, subjects: [{ id: 'geography', name: 'География', grades: [[5, 1]], displayed_average: 5, app_more_fives: 0 }],
      previousPeriods: [{ ...previous, period: { start: '2026-09-01', end: '2026-11-22' } }] }
    const source = { complete: true, marksScope: 'subject-period-full', fetchedAt: '2026-11-26T13:00:00Z', marks: [
      { subject_name: 'География', ...period, period: period.title, count: 1, average: '5.00', marks: [{ value: 5, weight: 1 }] },
      { subject_name: 'Математика', ...period, period: period.title, count: 1, average: '4.00', marks: [{ value: 4, weight: 1 }] },
    ] }
    const result = proposeGradeSnapshot(old, source, report)
    expect(result.proposal.subjects[1]).toMatchObject({ id: 'math', grades: [[4, 1]], displayed_average: 4 })
    expect(result.proposal.previousPeriods).toEqual(old.previousPeriods)
    expect(result.proposal.period).toEqual(period)
    expect(result.proposal.observed_subject_count).toBe(2)
    expect(proposeGradeSnapshot(result.proposal, source, report).changes).toEqual([])
    for (const patch of [{ marksScope: 'partial' },
      { marks: [source.marks[0], { ...source.marks[1], start: '2026-09-01' }] },
      { marks: [source.marks[0], { ...source.marks[1], average: '5.00' }] },
      { marks: [source.marks[0], { ...source.marks[1], subject_name: 'Незнакомый' }] },
    ]) expect(() => proposeGradeSnapshot(old, { ...source, ...patch }, report)).toThrow()
  })
  it('starts an explicitly confirmed later period without mixing or losing the previous ledger', () => {
    const old = { ...previous, period: { start: '2026-09-01', end: '2026-11-22' } }
    const fresh = { ...mesh, fetchedAt: '2026-11-24T10:48:40Z', marksScope: 'subject-period-full',
      marks: [{ subject_name: 'Математика', start: '2026-11-23', end: '2027-02-21', period: 'Период 2',
        count: 1, average: '5.00', marks: [{ value: 5, weight: 1 }] }] }
    const result = proposeGradeSnapshot(old, fresh, report, { startNewPeriod: true })
    expect(result.proposal.period).toMatchObject({ start: '2026-11-23', end: '2027-02-21', index: 2 })
    expect(result.proposal.subjects[0].grades).toEqual([[5, 1]])
    expect(result.proposal.previousPeriods[0]).toEqual(old)
    expect(old.subjects[0].grades).toEqual([[5, 1], [4, 1]])
    expect(proposeGradeSnapshot(result.proposal, fresh, report).changes).toEqual([])
    const added = { ...fresh, marks: [{ ...fresh.marks[0], count: 2, marks: [{ value: 5, weight: 1 }, { value: 5, weight: 1 }] }] }
    expect(proposeGradeSnapshot(result.proposal, added, report).proposal.snapshot_id).toMatch(/period-2$/)
    for (const source of [
      { ...fresh, marksScope: 'partial' },
      { ...fresh, marks: [{ ...fresh.marks[0], start: '2026-11-01' }] },
      { ...fresh, marks: [{ ...fresh.marks[0], count: 2 }] },
      { ...fresh, marks: [{ ...fresh.marks[0], average: '4.00' }] },
      { ...fresh, marks: [{ ...fresh.marks[0], subject_name: 'Чужой предмет' }] },
    ]) expect(() => proposeGradeSnapshot(old, source, report, { startNewPeriod: true })).toThrow()
    expect(() => proposeGradeSnapshot(old, fresh, report)).toThrow()
  })
  it('keeps a new pass/fail subject with zero marks outside the numeric ledger', () => {
    const source={...mesh,marks:[{...mesh.marks[0],fixed_value:'5'},
      {subject_name:'Практикум',average:'0.00',count:0,marks:[],fixed_value:'Зч'}]}
    const saved=structuredClone(source),result=proposeGradeSnapshot(previous,source,report)
    expect(result.proposal.subjects).toHaveLength(1)
    expect(result.proposal.subjects[0].grades).toEqual([[5,1],[4,1],[5,1]])
    expect(result.proposal.subjects[0].displayed_average).toBe(4.67)
    expect(source).toEqual(saved)
    expect(proposeGradeSnapshot(result.proposal,source,report).changes).toEqual([])
  })
  it('still rejects an unregistered graded subject, a fake empty row, duplicates or a missing old subject',()=>{
    const empty={subject_name:'Практикум',average:'0.00',count:0,marks:[],fixed_value:'Зч'}
    for(const patch of [{count:1},{marks:[{value:5,weight:1}]},{average:'4.00'},{average:null},{average:''}])
      expect(()=>proposeGradeSnapshot(previous,{...mesh,marks:[...mesh.marks,{...empty,...patch}]},report)).toThrow(/Набор предметов/)
    expect(()=>proposeGradeSnapshot(previous,{...mesh,marks:[...mesh.marks,...mesh.marks]},report)).toThrow(/Набор предметов/)
    expect(()=>proposeGradeSnapshot(previous,{...mesh,marks:[empty]},report)).toThrow(/Набор предметов/)
  })
  it('добавляет только подтверждённую оценку и повторно ничего не меняет', () => {
    const first = proposeGradeSnapshot(previous, mesh, report)
    expect(first.changes).toEqual([{ subject: 'Математика', previous: 4.5, current: 4.67, added: [[5, 1]],
      previous_app_more_fives: 9, app_more_fives: 2 }])
    expect(first.proposal.subjects[0].grades).toEqual([[5, 1], [4, 1], [5, 1]])
    expect(first.proposal.subjects[0].app_more_fives).toBe(2)
    const second = proposeGradeSnapshot(first.proposal, mesh, report)
    expect(second.changes).toEqual([])
    expect(second.proposal).toBe(first.proposal)
  })
  it('принимает техническую квитанцию, но отвергает произвольный источник', () => {
    const ref = 'operator-run:cc4eba28-6d8f-484f-8620-b8718139d7f1'
    expect(proposeGradeSnapshot(previous, mesh, ref).proposal.source_report).toBe(ref)
    expect(() => proposeGradeSnapshot(previous, mesh, '/tmp/anything')).toThrow()
  })
  it('останавливает потерю, исправление и неполную ленту', () => {
    expect(() => proposeGradeSnapshot(previous, { ...mesh, marks: [{ ...mesh.marks[0], count: 2, average: 5, marks: [{ value: 5, weight: 1 }, { value: 5, weight: 1 }] }] }, report)).toThrow(/изменилась/)
    expect(() => proposeGradeSnapshot(previous, { ...mesh, marks: [{ ...mesh.marks[0], marks: mesh.marks[0].marks.slice(0, 2) }] }, report)).toThrow(/Неполная/)
  })
  it('останавливается при отсутствующем или некорректном условном пороге и при плохом подтверждённом журнале', () => {
    expect(() => proposeGradeSnapshot({ ...previous, working_threshold: undefined }, mesh, report)).toThrow(/условный рабочий порог/)
    expect(() => proposeGradeSnapshot({ ...previous, working_threshold: 4 }, mesh, report)).toThrow(/условный рабочий порог/)
    expect(() => proposeGradeSnapshot({ ...previous, working_threshold_status: 'confirmed' }, mesh, report)).toThrow(/условный рабочий порог/)
    expect(() => proposeGradeSnapshot({ ...previous, subjects: [{ ...previous.subjects[0], grades: [[6, 1]] }] }, mesh, report)).toThrow(/Некорректный подтверждённый журнал/)
  })
  it('исправляет устаревший расчёт без новых оценок и повторно возвращает тот же объект', () => {
    const unchangedMesh = { ...mesh, marks: [{ ...mesh.marks[0], count: 2, average: 4.67,
      marks: [{ value: 5, weight: 2 }, { value: 4, weight: 1 }] }] }
    const weightedPrevious = { ...previous,
      subjects: [{ ...previous.subjects[0], grades: [[5, 2], [4, 1]], displayed_average: 4.67, app_more_fives: 8 }] }
    const repaired = proposeGradeSnapshot(weightedPrevious, unchangedMesh, report)
    expect(repaired.changes).toHaveLength(1)
    expect(repaired.changes[0]).toMatchObject({ added: [], previous_app_more_fives: 8, app_more_fives: 2 })
    expect(repaired.proposal.subjects[0].grades).toEqual([[5, 2], [4, 1]])
    const repeated = proposeGradeSnapshot(repaired.proposal, unchangedMesh, report)
    expect(repeated.changes).toEqual([])
    expect(repeated.proposal).toBe(repaired.proposal)
  })
})

 it('проверяет реальную квитанцию: успех, запись и временной охват снимка', () => {
   const receipt = { operation: 'project.collect', status: 'succeeded', apply: true,
     runId: 'cc4eba28-6d8f-484f-8620-b8718139d7f1', startedAt: '2026-10-16T06:00:00Z', finishedAt: '2026-10-16T07:00:00Z' }
   expect(gradeCollectionProvenance(receipt, mesh)).toBe(`operator-run:${receipt.runId}`)
   for (const patch of [{status:'failed'}, {apply:false}, {startedAt:undefined}, {finishedAt:'2026-10-15T07:00:00Z'}, {operation:'queue.scan'}]) {
     expect(() => gradeCollectionProvenance({...receipt,...patch}, mesh)).toThrow(/Квитанция/)
   }
 })
