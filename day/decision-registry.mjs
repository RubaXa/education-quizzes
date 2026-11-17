/** @see ../docs/decisions/adaptive-review-modes-2026-11-17.md */
import {subjectDecisionProfiles} from '../sync/subject-decisions.mjs'
import {presentationContractForRule} from '../packages/education-presentation/task-presentation.mjs'
/** Stable graph identity shared by the operator plan, real task frames and UI Kit.
 * @see ../docs/modules/reviews/criteria-and-knowledge.md#scenarios */
const decisionRef='docs/decisions/criteria-knowledge-ui-kit-2026-11-16.md'
const adaptiveRef='docs/decisions/adaptive-review-modes-2026-11-17.md'
const node=(id,label,actor,specRef,ref=decisionRef)=>({id,label,actor,specRef,decisionRef:ref})
export const decisionNodes=[
 node('source.mesh','Запись МЭШ','code','docs/modules/school-diary/README.md'),
 node('source.upload','Загруженный материал','code','docs/modules/materials/README.md'),
 node('source.parent','Контекст родителя','agent','docs/modules/synchronization/subject-decision-graph.md#inputs'),
 node('source.identity','Владелец и ревизия','code','docs/shared/data/firestore.md'),
 node('source.criteria','Полные условия и критерии','agent+gate','docs/modules/reviews/criteria-and-knowledge.md#criteria'),
 node('learner.evidence','Свидетельства навыков','code','docs/modules/reviews/criteria-and-knowledge.md#knowledge'),
 node('source.obligation','Какое действие прямо назначено?','agent+gate','docs/modules/synchronization/subject-decision-graph.md#teacher-obligation'),
 node('source.context','Служебные сведения без учебной обязанности','code','docs/modules/synchronization/subject-decision-graph.md#teacher-obligation'),
 node('subject.choose','Выбор предметного действия','agent+code','docs/modules/synchronization/subject-decision-graph.md#subjects'),
 node('artifact.prepare','Нужный учебный продукт','agent+gate','docs/modules/reviews/card-generation-policy.md'),
 node('view.role','Проекции ученика и родителя','code','docs/modules/reviews/subject-card-viewmodel.md'),
 node('view.component','Общая карточка и UI Kit','code','docs/shared/design/ui-kit.md'),
 node('publish','Запись и обратное чтение','code','docs/services/operator-cli/README.md'),
 node('learner.context','Что уточнил ребёнок','agent+gate','docs/shared/design/student-review-step.md#assignment-clarification',adaptiveRef),
 node('family.requirement','Обязательность в семейном плане','parent+code','docs/shared/design/student-review-step.md#assignment-clarification',adaptiveRef),
 node('review.support','Режим помощи по проверенному ответу','agent+gate','docs/shared/design/student-review-step.md#adaptive-support',adaptiveRef),
 node('review','Проверка ответа','agent+gate','docs/modules/reviews/review-criteria-provenance.md'),
 node('knowledge','Запись нового наблюдения','code','docs/modules/reviews/criteria-and-knowledge.md#knowledge'),
 ...Object.entries(subjectDecisionProfiles).flatMap(([subject,p])=>p.rules.map(r=>({...r,id:r.nodeId,label:r.when,subject,actor:r.executor})))
]
const edge=(id,from,to,label,specRef,ref=decisionRef)=>({id,from,to,label,specRef,decisionRef:ref})
export const decisionEdges=[
 ...['mesh','upload','parent'].map(source=>edge(`input:${source}`,`source.${source}`,'source.identity','Сопоставить назначение','docs/modules/synchronization/subject-decision-graph.md#inputs')),
 edge('identity:criteria','source.identity','source.criteria','Разобрать полный источник','docs/modules/reviews/criteria-and-knowledge.md#criteria'),
 edge('criteria:choose','source.criteria','source.obligation','Отделить назначение от служебных сведений','docs/modules/synchronization/subject-decision-graph.md#subjects'),
 edge('obligation:choose','source.obligation','subject.choose','Есть прямое назначение: выбрать действие','docs/modules/synchronization/subject-decision-graph.md#teacher-obligation'),
 edge('obligation:context','source.obligation','source.context','Только счётчик или метаданные: не создавать долг','docs/modules/synchronization/subject-decision-graph.md#teacher-obligation'),
 edge('evidence:choose','learner.evidence','subject.choose','Учесть прежние результаты и помощь','docs/modules/reviews/criteria-and-knowledge.md#knowledge'),
 ...Object.values(subjectDecisionProfiles).flatMap(p=>p.rules.flatMap(r=>[edge(r.edgeIds[0],'subject.choose',r.nodeId,r.when,r.specRef),edge(r.edgeIds[1],r.nodeId,'artifact.prepare',r.product,r.specRef)])),
 edge('component:context','view.component','learner.context','Получить ответ или уточнение','docs/shared/design/student-review-step.md#assignment-clarification',adaptiveRef),
 edge('family:component','family.requirement','view.component','Показать сохранённый семейный выбор без изменения оценки','docs/shared/design/student-review-step.md#assignment-clarification',adaptiveRef),
 edge('context:clarification','learner.context','review.support','Понять ответ и сверить источник','docs/shared/design/student-review-step.md#assignment-clarification',adaptiveRef),
 edge('clarification:family','review.support','family.requirement','Неразрешённое противоречие: решение родителя','docs/shared/design/student-review-step.md#assignment-clarification',adaptiveRef),
 edge('review:support','review','review.support','Ответ, затруднение или уточнение','docs/shared/design/student-review-step.md#adaptive-support',adaptiveRef),
 edge('support:component','review.support','view.component','Тот же блок в выбранном режиме','docs/shared/design/student-review-step.md#adaptive-support',adaptiveRef),
 ...[['artifact.prepare','view.role'],['view.role','view.component'],['view.component','publish'],['publish','review'],['review','knowledge'],['knowledge','learner.evidence']].map(([from,to])=>edge(`${from}:${to}`,from,to,'Проверенный переход',decisionNodes.find(n=>n.id===to).specRef))
]

/** Bind every graph element to real compositions; shared steps retain the selected subject.
 * Technical steps have no independent family screen: the inspector names their observable consequence.
 * @see ../docs/modules/reviews/criteria-and-knowledge.md#scenarios */
const rules=Object.values(subjectDecisionProfiles).flatMap(profile=>profile.rules)
const ruleIds=rules.map(rule=>rule.id)
const productContractIds=[...new Set(rules.map(rule=>presentationContractForRule(rule).id))]
const technicalNotes={
 'source.context':'Отдельной семейной карточки нет. Учебного долга нет. Счётчик материалов помогает оператору найти источник, но не требует от ребёнка выполнения или загрузки результата.',
 'source.identity':'Отдельной семейной карточки нет. Сопоставление определяет, к какому назначению относятся оригинал и работа.',
 'learner.evidence':'Отдельной семейной карточки нет. Подтверждённые результаты влияют на следующий вопрос и объём помощи.',
 publish:'Отдельной семейной карточки нет. Результат виден в опубликованной карточке обеих ролей после обратного чтения.',
 knowledge:'Отдельной семейной карточки нет. Новое наблюдение сохраняется отдельно от зачёта и учитывается при следующей подготовке.',
}
function bind(item,rule,scope,technicalNote){
 item.uiScenarioIds=rule?[rule.id]:[...ruleIds]
 if(rule)item.uiScenarioId=rule.id
 item.presentationScope=scope
 item.presentationContractIds=scope==='source'?['source-context']:scope==='result'?['review-result']:scope==='clarification'?['assignment-clarification']:rule?[presentationContractForRule(rule).id]:[...productContractIds]
 item.technical=Boolean(technicalNote)
 if(technicalNote)item.presentationNote=technicalNote
}
const commonNodeScopes={
 'source.mesh':'source','source.upload':'source','source.parent':'source','source.identity':'source','source.criteria':'source','source.obligation':'source','source.context':'source',
 'learner.evidence':'result','subject.choose':'context','artifact.prepare':'context','view.role':'context','view.component':'context',
 'learner.context':'clarification','family.requirement':'clarification','review.support':'result',publish:'context',review:'result',knowledge:'result',
}
const commonEdgeScopes={
 'input:mesh':'source','input:upload':'source','input:parent':'source','identity:criteria':'source',
 'criteria:choose':'source','obligation:choose':'context','obligation:context':'source','evidence:choose':'result','artifact.prepare:view.role':'context','view.role:view.component':'context',
 'component:context':'clarification','family:component':'clarification','context:clarification':'clarification','clarification:family':'clarification','review:support':'result','support:component':'result','view.component:publish':'context','publish:review':'context','review:knowledge':'result','knowledge:learner.evidence':'result',
}
/** New common graph elements require an explicit binding, never an inferred generic card. */
export function decisionCommonScope(kind,id){
 const scopes=kind==='node'?commonNodeScopes:kind==='edge'?commonEdgeScopes:undefined
 if(!scopes||!Object.hasOwn(scopes,id))throw Error(`Нет утверждённого макета общего элемента ${kind}:${id}.`)
 return scopes[id]
}
for(const item of decisionNodes){
 const rule=rules.find(rule=>rule.nodeId===item.id)
 bind(item,rule,rule?'rule':decisionCommonScope('node',item.id),technicalNotes[item.id])
}
for(const item of decisionEdges){
 const rule=rules.find(rule=>rule.edgeIds.includes(item.id))
 bind(item,rule,rule?'rule':decisionCommonScope('edge',item.id),item.to==='knowledge'||item.to==='learner.evidence'?technicalNotes.knowledge:item.to==='publish'?technicalNotes.publish:undefined)
}
export function decisionPresentationBinding(itemId,scenarioId){
 const item=[...decisionNodes,...decisionEdges].find(item=>item.id===itemId)
 if(!item)return undefined
 const rule=rules.find(rule=>rule.id===scenarioId)
 if(!rule||!item.uiScenarioIds.includes(rule.id))return undefined
 const contractIds=item.presentationScope==='source'?['source-context']:item.presentationScope==='result'?['review-result']:item.presentationScope==='clarification'?['assignment-clarification']:[presentationContractForRule(rule).id]
 return {item,uiScenarioId:rule.id,contractIds,technical:item.technical,note:item.presentationNote}
}
