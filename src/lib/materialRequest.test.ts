import { describe, expect, it } from 'vitest'
import { materialRequestErrors, materialRequestView, sourceReviewErrors } from './materialRequest'

const task = { assessmentIntent:{state:'needs-topic'}, materialRequest:{id:'notes-1',state:'open' as const,question:'Какая последняя тема записана в тетради?',photoPrompt:'Пришли заголовок и записи последнего урока.'} }
const analysis = {requestId:'notes-1',topic:'Баллада',observed:'Виден заголовок и три определения.',quality:'Определения читаются, правый край обрезан.',limitation:'По снимку неизвестно, насколько самостоятельно сделаны записи.',nextStep:'Уточним последний пример по целой строке.',evidence:[{uploadId:'photo-1',location:'Верхняя часть страницы',text:'Заголовок «Баллада» и записи ниже.'}]}
/** @see ../../docs/modules/materials/material-clarification.md */
describe('a source request is separate from completion',()=>{
  it('validates a request and never invents a topic from the MESH pointer',()=>{
    expect(materialRequestErrors(task)).toEqual([])
    expect(materialRequestView(task,[])?.phase).toBe('waiting')
    expect(materialRequestErrors({...task,assessmentIntent:{state:'confirmed'}})).not.toEqual([])
    expect(materialRequestErrors({...task,materialRequest:{...task.materialRequest,state:'resolved'}})).not.toEqual([])
  })
  it('tracks transfer, received material and an observed topic without grading',()=>{
    expect(materialRequestView(task,[{status:'awaiting-upload'}])?.phase).toBe('uploading')
    expect(materialRequestView(task,[{status:'pending'}])?.phase).toBe('received')
    const review={purpose:'source-material',sourceAnalysis:analysis,uploadIds:['photo-1']}
    expect(sourceReviewErrors(review,task)).toEqual([])
    expect(materialRequestView(task,[{status:'reviewed'}],review)?.phase).toBe('identified')
    expect(materialRequestView(task,[{status:'pending'}],review)?.phase).toBe('received')
    expect(sourceReviewErrors({...review,status:'verified'},task)).not.toEqual([])
    expect(sourceReviewErrors({...review,workCoverage:{state:'complete'}},task)).not.toEqual([])
    expect(sourceReviewErrors({...review,uploadIds:['another']},task)).not.toEqual([])
    expect(sourceReviewErrors({...review,sourceAnalysis:{...analysis,requestId:'other'}},task)).not.toEqual([])
    expect(sourceReviewErrors({status:'verified'},task)).not.toEqual([])
    expect(sourceReviewErrors({status:'verified'},{})).toEqual([])
  })
})

/** @see ../../docs/modules/materials/material-clarification.md */
describe('work arriving under an independent material request', () => {
  const scopedTask = { ...task, learnerFlow: { scope: 'Учебник, страница 37, упражнения 4–5.', source: { pageId: 'starlight-6-2022:37' } } }
  const work = { status: 'partial', uploadIds: ['letter'], workScope: { kind: 'known-part', requestId: 'notes-1', sourceRef: 'starlight-6-2022:37', scope: 'Учебник, страница 37, упражнения 4–5.', observedContent: 'На снимке собственное письмо, а не страница тетради.' } }
  it('permits the existing confirmed part while keeping the request open', () => {
    expect(sourceReviewErrors(work, scopedTask)).toEqual([])
    expect(materialRequestView(scopedTask, [{status:'reviewed'}], work)?.phase).toBe('waiting')
    expect(scopedTask.materialRequest.state).toBe('open')
  })
  it('rejects full completion and complete coverage with a missing source', () => {
    expect(sourceReviewErrors({...work,status:'verified'}, scopedTask)).not.toEqual([])
    expect(sourceReviewErrors({...work,workCoverage:{state:'complete'}}, scopedTask)).not.toEqual([])
  })
  it('requires the exact request and already published source and scope', () => {
    for (const patch of [{requestId:'other'}, {sourceRef:'unknown-source'}, {scope:'Whole workbook'}, {observedContent:''}])
      expect(sourceReviewErrors({...work,workScope:{...work.workScope,...patch}}, scopedTask)).not.toEqual([])
    expect(sourceReviewErrors(work, task)).not.toEqual([])
  })
})
