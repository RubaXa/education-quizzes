import {expect,it} from 'vitest'
import {problemPresentationErrors,guidePresentationErrors,materialRequestPresentationErrors,presentationContractForRule} from './task-presentation.mjs'
const condition='На складе было 18 т груза. В первый день вывезли в два раза меньше, чем во второй. Осталось 3 т. Сколько тонн вывезли во второй день?'
it('rejects the reproduced whole-condition tile and generic target before publication',()=>{
 const errors=problemPresentationErrors({original:{text:condition},support:{facts:[{label:'Условие',value:condition}],find:'Результат и обоснование, прямо запрошенные в условии.'}})
 expect(errors.join(' ')).toContain('продублировано');expect(errors.join(' ')).toContain('конкретное искомое')
})
it('accepts separate source facts for each subpart without putting the result in the learner model',()=>{
 const part={id:'one',title:'1. Груз',facts:[{label:'Всего',value:'18 т'},{label:'Осталось',value:'3 т'},{label:'Во второй день',value:'Вдвое больше, чем в первый'}],find:'Масса груза, вывезенного во второй день'}
 expect(problemPresentationErrors({original:{text:condition},support:{facts:[],find:'',parts:[part,{...part,id:'two',title:'2. Другой случай'}]}})).toEqual([])
 expect(problemPresentationErrors({support:{facts:[{label:'Условие',value:condition}],find:'Ответ',parts:[part,{...part,id:'two'}]}}).join()).toContain('дублировать подпункты')
})
it('requires a concrete method and allows blocks instead of duplicated legacy rows',()=>{
 const guide={presentation:'math-route',method:{name:'Части',reason:'Массы связаны кратным отношением.',steps:['Найти вывезенную массу','Разделить её по отношению']},stages:[{id:'solution',expected:'Вывезенное распределяется между двумя днями.',rows:[],blocks:[{kind:'flow',label:'Переходы',steps:['Всего минус остаток','Распределить по отношению']}]}]}
 expect(guidePresentationErrors(guide)).toEqual([])
 expect(guidePresentationErrors({...guide,method:undefined}).join()).toContain('guide.method')
 expect(guidePresentationErrors({...guide,stages:[{...guide.stages[0],rows:[{label:'Решение',value:'Вторая копия'}]}]}).join()).toContain('без двух копий')
})
it('requires the known/missing/reason/search/action contract and rejects asking for received pages',()=>{
 const presentation={version:1,available:['Рабочая тетрадь, страницы 8–9'],missing:['Страница 10 целиком'],reason:'На имеющемся фото виден только край следующей страницы.',action:'Добавь страницу 10 целиком.',checkedAt:'2026-11-16T12:00:00Z',checkedSources:['Библиотека семьи','Сохранённые фотографии'],coverage:{collectionId:'example-workbook',availablePages:[8,9],missingPages:[10]}}
 expect(materialRequestPresentationErrors({presentation})).toEqual([])
 expect(materialRequestPresentationErrors({presentation:{...presentation,coverage:{...presentation.coverage,missingPages:[9,10]}}}).join()).toContain('пересекаются')
 expect(materialRequestPresentationErrors({question:'Загрузите ещё раз'}).join()).toContain('общий макет')
})
it('fails closed for a product without an approved presentation binding',()=>{
 expect(()=>presentationContractForRule({id:'new.rule',product:'unregistered-layout'})).toThrow(/Нет утверждённого/)
})
it('rejects malformed and private fields instead of publishing or crashing',()=>{
 expect(problemPresentationErrors({support:{facts:[],find:'',parts:[null,{id:'two',title:'2',facts:[null],find:'Масса'}]}}).length).toBeGreaterThan(0)
 expect(materialRequestPresentationErrors({presentation:{version:1,answer:'closed-key',available:[],missing:[],checkedSources:[]}}).join()).toContain('неизвестные поля')
})
