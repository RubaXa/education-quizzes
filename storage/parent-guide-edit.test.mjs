import {expect,it} from 'vitest'
import {parentGuideEditErrors} from './parent-guide-edit.mjs'
it('fences a presentation-only edit without changing source, stage identity or checked work',()=>{
 const source={kind:'family',ref:'task',excerpt:'Точное условие',label:'Исходник'}
 const guide={kind:'structured-notes',presentation:'learning-route',pattern:'source-evidence',revision:3,stages:[{id:'evidence',source,reviewLabels:['Проверка']}]}
 const input={version:1,expectedGuideRevision:3,sourceRevision:6,reason:'Родитель попросил понятный структурированный путь.',guide:{...guide,revision:4,stages:[{...guide.stages[0],title:'Проверяем случаи',expected:'Общая сумма задаёт конечный перебор.',hintPreview:'Как ограничить сумму?',revealPreview:'Полный шаг показан в блоках.',blocks:[{kind:'text',text:'Все случаи должны быть учтены.'}]}]}}
 expect(parentGuideEditErrors({guide,sourceRevision:6},input)).toEqual([])
 expect(parentGuideEditErrors({guide,sourceRevision:7},input).join()).toContain('Ревизия')
 input.guide.stages[0].id='new-stage';expect(parentGuideEditErrors({guide,sourceRevision:6},input).join()).toContain('ID')
})
