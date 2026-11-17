import { describe, expect, it } from 'vitest'
import { preparationExpiry, ensureContinuousPreparation, preparationVisible,activePreparations } from './preparation-window.mjs'

it('publishes the same course sheet from first availability, retains it on weekdays and after a week boundary', () => {
  const source = { targetDate: '2026-11-12', subjects: [{ name: 'Спецкурс по математике', tasks: [{ id: 'sheet', problems: [{ id: 'p1' }] }] }] }
  expect(ensureContinuousPreparation(source, '2026-11-07')).toBe(true)
  expect(source.weekendSlot.preparationThrough).toBe('2026-11-10')
  expect(preparationVisible(source.weekendSlot, '2026-11-06')).toBe(false)
  for (const date of ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-16']) expect(preparationVisible(source.weekendSlot, date)).toBe(true)
  expect(ensureContinuousPreparation(source, '2026-11-09')).toBe(false)
  expect(source.weekendSlot.availableFrom).toBe('2026-11-07')
})
it('does not confuse notebook hand-in with course work or rewrite a legacy weekend', () => {
  const source = { targetDate: '2026-11-11', subjects: [{ name: 'Практикум по решению математических задач', tasks: [{ id: 'hand-in', kind: 'check' }] }] }
  expect(ensureContinuousPreparation(source, '2026-11-07')).toBe(false)
  expect(preparationVisible({ dates: ['2026-11-07', '2026-11-08'] }, '2026-11-09')).toBe(false)
})
it('shows exactly one current course while preserving ordinary homework and several controls',()=>{
 const slots=[
  {kind:'course',lessonDate:'2026-11-12',title:'Спецкурс ДЗ-09',mode:'until-complete',availableFrom:'2026-11-07',dates:['2026-11-07'],taskIds:['old']},
  {kind:'course',lessonDate:'2026-11-19',title:'Спецкурс ДЗ-10',mode:'until-complete',availableFrom:'2026-11-14',dates:['2026-11-14'],taskIds:['current']},
  {kind:'control',lessonDate:'2026-11-19',title:'Подготовка',mode:'until-complete',availableFrom:'2026-11-16',dates:['2026-11-16'],taskIds:['math','russian']},
  {kind:'homework',title:'ДЗ',dates:['2026-11-17'],taskIds:['homework']},
 ]
 const before=structuredClone(slots)
 expect(activePreparations(slots,'2026-11-13').map(s=>s.taskIds)).toEqual([['old']])
 expect(activePreparations(slots,'2026-11-17').map(s=>s.taskIds)).toEqual([['current'],['math','russian'],['homework']])
 expect(slots).toEqual(before)
 expect(activePreparations(slots.map(({kind:_kind,...s})=>s),'2026-11-17').filter(s=>s.title.startsWith('Спецкурс'))).toHaveLength(1)
})
it('adds one three-day control block for several subjects without replacing the existing course sheet', () => {
  const source={targetDate:'2026-11-19',subjects:[
    {name:'Математика',tasks:[{id:'math-control',kind:'check',meshText:'Самостоятельная работа по комбинаторике',testToken:'math-quiz'}]},
    {name:'Русский язык',tasks:[{id:'russian-control',kind:'check',meshText:'Контрольная работа',testToken:'russian-quiz'}]},
  ],testPlacements:[{taskId:'math-control',token:'math-quiz'},{taskId:'russian-control',token:'russian-quiz'}],
  weekendSlot:{dates:['2026-11-14'],title:'Старый лист',taskIds:['course']}}
  const previous=structuredClone(source.weekendSlot)
  expect(ensureContinuousPreparation(source,'2026-11-12')).toBe(true)
  expect(source.controlPreparationSlot).toMatchObject({mode:'until-complete',availableFrom:'2026-11-16',preparationThrough:'2026-11-18',dueDate:'2026-11-19',taskIds:['math-control','russian-control']})
  expect(source.weekendSlot).toEqual(previous)
  expect(preparationVisible(source.controlPreparationSlot,'2026-11-15')).toBe(false)
  expect(preparationVisible(source.controlPreparationSlot,'2026-11-16')).toBe(true)
  expect(ensureContinuousPreparation(source,'2026-11-17')).toBe(false)
})
it('uses the day of late publication, and never publishes an empty placeholder instead of a real preparation',()=>{
 const source={targetDate:'2026-11-19',subjects:[{name:'Математика',tasks:[{id:'control',meshText:'Самостоятельная работа'}]}]}
 expect(ensureContinuousPreparation(source,'2026-11-17')).toBe(false)
 source.subjects[0].tasks[0].problems=[{id:'p1'}]
 expect(ensureContinuousPreparation(source,'2026-11-17')).toBe(true)
 expect(source.controlPreparationSlot.availableFrom).toBe('2026-11-17')
})
/** @see ../docs/modules/synchronization/global-sync.md#operator-queue */
const window = ['2026-11-02', '2026-12-13']
describe('moving weekly preparation window', () => {
  it('archives last week, retaining Monday and the entire current week', () => {
    expect(preparationExpiry({kind:'enrich-task',source:{date:'2026-10-30'}},window)).toContain('active-from:2026-11-02')
    for (const date of ['2026-11-02','2026-11-03','2026-11-09']) expect(preparationExpiry({kind:'material-needed',source:{date}},window)).toBeNull()
  })
  it('never expires attempts, help, event actions or unknown source dates', () => {
    for (const kind of ['review-work','review-quiz','triage-help','repair-review','prepare-targeted-followup'])
      expect(preparationExpiry({kind,source:{date:'2026-10-20'}},window)).toBeNull()
    expect(preparationExpiry({kind:'enrich-task',artifactPath:'operatorSyncTaskArtifacts/id',source:{date:'2026-10-20'}},window)).toBeNull()
    expect(preparationExpiry({kind:'enrich-task',source:{}},window)).toBeNull()
  })
})
