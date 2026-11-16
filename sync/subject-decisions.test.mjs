import { expect, it } from 'vitest'
import { subjectDecisionPlan, subjectDecisionProfiles } from './subject-decisions.mjs'
import { taskRoute } from './task-route.mjs'
it.each(['geography','biology'])('does not turn a material counter or an authored platform card into teacher homework: %s',subject=>{
 const task={id:'mesh-counter',kind:'check',meshText:'п.38',outputKind:'platform-result',materialCounts:{count_execute:1},instructionStatus:{state:'reviewed'},assessmentIntent:{state:'confirmed',mode:'ordinary',topic:'Параграф',evidenceRef:'book:38'}}
 const plan=subjectDecisionPlan(task,subject)
 expect(plan.actions.some(a=>a.action==='platform')).toBe(false);expect(plan.obligationErrors).toHaveLength(1)
 const route=taskRoute(task,subject);expect(route.next).toBe('correct-unassigned-obligation');expect(route.steps).not.toContain('await-source-upload')
 expect(taskRoute({...task,meshText:'Выполнить ЦДЗ'},subject).next).not.toBe('correct-unassigned-obligation')
})
it('has a separate subject registry and three required input origins',()=>{
 expect(Object.keys(subjectDecisionProfiles)).toEqual(expect.arrayContaining(['math','special','russian','literature','english','history','geography','biology','informatics','technology']))
 const p=subjectDecisionPlan({kind:'read',meshText:'Читать главы6и7'},'literature')
 expect(p.inputs.map(x=>x.origin)).toEqual(['mesh','uploaded-material','parent-context'])
 expect(p.actions[0].ruleId).toBe('literature.reading')
})
it('keeps mixed written and oral products independent, rather than one classification',()=>{
 const r=taskRoute({id:'mesh-1',kind:'written',meshText:'Упр.2 письменно. Правило повторить.',instructionStatus:{state:'reviewed'}},'russian')
 expect(r.next).toBe('prepare-independent-actions')
 expect(r.subjectPlan.actions.map(x=>x.action)).toEqual(['written','oral'])
 expect(r.subjectPlan.actions.map(x=>x.product)).toEqual(['source-linked-written-guide','source-covered-quiz'])
})
it('uses confirmed assessment intent and reuses a linked test in a mixed assignment',()=>{
 const plan=subjectDecisionPlan({kind:'check',meshText:'Python while',instructionStatus:{state:'reviewed'},assessmentIntent:{state:'confirmed',mode:'ordinary',topic:'Python while',evidenceRef:'teacher:source'}},'informatics')
 expect(plan.actions.length).toBeGreaterThan(0)
 const route=taskRoute({id:'m',kind:'written',meshText:'Упр.3 письменно. Правило повторить',testToken:'existing',instructionStatus:{state:'reviewed'}},'russian')
 expect(route.steps).toContain('read-and-reuse-current-assessment-before-preparing-missing-products')
 expect(route.subjectPlan.actions.find(a=>a.action==='oral').existingProductRef).toBe('existing')
})
it('routes explicit organizational work and information without inventing a quiz',()=>{
 expect(taskRoute({id:'mesh-2',meshText:'Взять тетрадь и сдать в среду',kind:'check',instructionStatus:{state:'reviewed'}},'special').next).toBe('prepare-organisational-reminder')
 expect(taskRoute({id:'mesh-3',meshText:'нет',instructionStatus:{state:'reviewed'}},'history').next).toBe('information-only')
 expect(taskRoute({id:'mesh-4',meshText:'нет',instructionStatus:{state:'reviewed'}},'history',{decisionContext:{hasTeacherFiles:true}}).next).not.toBe('information-only')
})
it('chooses precise subject forms and keeps platform evidence separate',()=>{
 expect(subjectDecisionPlan({kind:'written',meshText:'Подготовка к изложению'},'russian').actions[0].ruleId).toBe('russian.retelling')
 expect(subjectDecisionPlan({kind:'written',meshText:'Письмо о национальном блюде'},'english').actions[0].checks.join(' ')).toContain('содержательные')
 expect(subjectDecisionPlan({kind:'written',meshText:'Python: цикл while'},'technology').subject).toBe('informatics')
 expect(subjectDecisionPlan({kind:'cdz',meshText:'ЦДЗ'},'geography').actions[0].product).toBe('external-platform-evidence')
})

it('does not mistake an attachment for a mathematics worksheet or an instruction stamp for source completeness',()=>{
 const read=subjectDecisionPlan({kind:'read',meshText:'Прочитать теорию из файла',materialStatus:{state:'teacher-attachment-linked'}},'special')
 expect(read.actions.map(x=>x.action)).toEqual(['oral'])
 expect(subjectDecisionPlan({meshText:'Из файла'},'special',{hasTeacherFiles:true}).actions[0].action).toBe('classify-material')
 expect(subjectDecisionPlan({kind:'check',meshText:'Из файла. Тетради сдать на проверку в среду.'},'special',{hasTeacherFiles:true}).actions.map(x=>x.action)).toEqual(['classify-material','organization'])
 expect(subjectDecisionPlan({instructionStatus:{state:'reviewed'},materialStatus:{state:'textbook-page-needed'}},'english').sourceReadiness).toBe('missing-part')
})
it('keeps English written exercises distinct from letters and preserves listening next to vocabulary',()=>{
 expect(subjectDecisionPlan({outputKind:'written',meshText:'Выполнить письменно упр.3'},'english').actions[0].ruleId).toBe('english.exercise')
 expect(subjectDecisionPlan({outputKind:'written',meshText:'Подготовка к изложению'},'russian').actions[0].ruleId).toBe('russian.retelling')
 expect(subjectDecisionPlan({meshText:'Выучить слова и прослушать аудио'},'english').actions.map(x=>x.ruleId)).toEqual(['english.vocabulary','english.listening'])
 expect(subjectDecisionPlan({outputKind:'oral',meshText:'Выучить слова к диктанту'},'russian').actions[0].ruleId).toBe('russian.vocabulary')
})

it('does not turn independently doing an exercise into a school control and keeps speaking distinct',()=>{
 expect(subjectDecisionPlan({kind:'written',meshText:'Самостоятельно выполнить упр.3'},'russian').actions.map(x=>x.action)).toEqual(['written'])
 const speaking=subjectDecisionPlan({kind:'read',meshText:'Устно рассказать о любимом национальном блюде'},'english')
 expect(speaking.actions[0].ruleId).toBe('english.speaking')
 expect(speaking.actions[0].checks.join(' ')).toContain('содержательные')
})
it('covers each recovered previous-lesson part and does not reopen old written work',()=>{
 const plan=subjectDecisionPlan({meshText:'Повторить предыдущий урок',repetition:{parts:[
 {id:'words',kind:'written',topic:'Выучить слова',materialState:'ready',materialRef:'book:words'},
 {id:'audio',kind:'oral',topic:'Listening',materialState:'missing',materialRef:'book:audio'}]}},'english')
 expect(plan.actions.map(x=>[x.partId,x.ruleId,x.sourceState])).toEqual([['words','english.vocabulary','confirmed-part'],['audio','english.listening','missing-part']])
 expect(plan.actions.every(x=>x.product==='current-repetition-quiz-covering-this-part')).toBe(true)
})
