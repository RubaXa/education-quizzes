import {expect,it} from 'vitest'
import {parentGuideEditErrors,guidePublication} from './parent-guide-edit.mjs'
import {readFileSync} from 'node:fs'
it('replaces the entire published guide and clears stale optional sources while preserving edit history',()=>{
 const deletion=Symbol('delete'),prior={guide:{revision:1,obsolete:'old'},guideEdits:[{guide:{revision:0}}],sourceResearch:{old:true},sourceRevision:2}
 const [data,options]=guidePublication({familyId:'synthetic',childId:'synthetic',taskId:'synthetic',guide:{revision:3},updatedAt:'now'},deletion)
 const after={...prior};for(const key of options.mergeFields){if(data[key]===deletion)delete after[key];else after[key]=data[key]}
 expect(after.guide).toEqual({revision:3});expect(after.guideEdits).toEqual(prior.guideEdits);expect(after.sourceResearch).toBeUndefined();expect(after.sourceRevision).toBeUndefined()
 const source=readFileSync(new URL('../scripts/day.mjs',import.meta.url),'utf8')
 expect(source.match(/\.\.\.guidePublication\(/g)).toHaveLength(5)
})
it('fences a presentation-only edit without changing source, stage identity or checked work',()=>{
 const source={kind:'family',ref:'task',excerpt:'Точное условие',label:'Исходник'}
 const guide={kind:'structured-notes',presentation:'learning-route',pattern:'source-evidence',revision:3,stages:[{id:'evidence',source,reviewLabels:['Проверка']}]}
 const input={version:1,expectedGuideRevision:3,sourceRevision:6,reason:'Родитель попросил понятный структурированный путь.',guide:{...guide,revision:4,stages:[{...guide.stages[0],title:'Проверяем случаи',expected:'Общая сумма задаёт конечный перебор.',hintPreview:'Как ограничить сумму?',revealPreview:'Полный шаг показан в блоках.',blocks:[{kind:'text',text:'Все случаи должны быть учтены.'}]}]}}
 expect(parentGuideEditErrors({guide,sourceRevision:6},input)).toEqual([])
 input.guide.table=[['invalid nested array']]
 expect(parentGuideEditErrors({guide,sourceRevision:6},input).join()).toContain('Firestore')
 delete input.guide.table
 input.guide.deep=Array.from({length:19}).reduce(v=>({child:v}),{leaf:'too deep to archive'})
 expect(parentGuideEditErrors({guide,sourceRevision:6},input).join()).toContain('Firestore')
 delete input.guide.deep
 expect(parentGuideEditErrors({guide,sourceRevision:7},input).join()).toContain('Ревизия')
 input.guide.stages[0].id='new-stage';expect(parentGuideEditErrors({guide,sourceRevision:6},input).join()).toContain('ID')
})
