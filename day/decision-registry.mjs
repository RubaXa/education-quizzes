import {subjectDecisionProfiles} from '../sync/subject-decisions.mjs'
/** Stable graph identity shared by the operator plan, real task frames and UI Kit.
 * @see ../docs/modules/reviews/criteria-and-knowledge.md#scenarios */
const decisionRef='docs/decisions/criteria-knowledge-ui-kit-2026-11-16.md'
const node=(id,label,actor,specRef)=>({id,label,actor,specRef,decisionRef})
export const decisionNodes=[
 node('source.mesh','Запись МЭШ','code','docs/modules/school-diary/README.md'),
 node('source.upload','Загруженный материал','code','docs/modules/materials/README.md'),
 node('source.parent','Контекст родителя','agent','docs/modules/synchronization/subject-decision-graph.md#inputs'),
 node('source.identity','Владелец и ревизия','code','docs/shared/data/firestore.md'),
 node('source.criteria','Полные условия и критерии','agent+gate','docs/modules/reviews/criteria-and-knowledge.md#criteria'),
 node('learner.evidence','Свидетельства навыков','code','docs/modules/reviews/criteria-and-knowledge.md#knowledge'),
 node('subject.choose','Выбор предметного действия','agent+code','docs/modules/synchronization/subject-decision-graph.md#subjects'),
 node('artifact.prepare','Нужный учебный продукт','agent+gate','docs/modules/reviews/card-generation-policy.md'),
 node('view.role','Проекции ученика и родителя','code','docs/modules/reviews/subject-card-viewmodel.md'),
 node('view.component','Общая карточка и UI Kit','code','docs/shared/design/ui-kit.md'),
 node('publish','Запись и обратное чтение','code','docs/services/operator-cli/README.md'),
 node('review','Проверка ответа','agent+gate','docs/modules/reviews/review-criteria-provenance.md'),
 node('knowledge','Запись нового наблюдения','code','docs/modules/reviews/criteria-and-knowledge.md#knowledge'),
 ...Object.entries(subjectDecisionProfiles).flatMap(([subject,p])=>p.rules.map(r=>({...r,id:r.nodeId,label:r.when,subject,actor:r.executor})))
]
const edge=(id,from,to,label,specRef)=>({id,from,to,label,specRef,decisionRef})
export const decisionEdges=[
 ...['mesh','upload','parent'].map(source=>edge(`input:${source}`,`source.${source}`,'source.identity','Сопоставить назначение','docs/modules/synchronization/subject-decision-graph.md#inputs')),
 edge('identity:criteria','source.identity','source.criteria','Разобрать полный источник','docs/modules/reviews/criteria-and-knowledge.md#criteria'),
 edge('criteria:choose','source.criteria','subject.choose','Выделить независимые действия','docs/modules/synchronization/subject-decision-graph.md#subjects'),
 edge('evidence:choose','learner.evidence','subject.choose','Учесть прежние результаты и помощь','docs/modules/reviews/criteria-and-knowledge.md#knowledge'),
 ...Object.values(subjectDecisionProfiles).flatMap(p=>p.rules.flatMap(r=>[edge(r.edgeIds[0],'subject.choose',r.nodeId,r.when,r.specRef),edge(r.edgeIds[1],r.nodeId,'artifact.prepare',r.product,r.specRef)])),
 ...[['artifact.prepare','view.role'],['view.role','view.component'],['view.component','publish'],['publish','review'],['review','knowledge'],['knowledge','learner.evidence']].map(([from,to])=>edge(`${from}:${to}`,from,to,'Проверенный переход',decisionNodes.find(n=>n.id===to).specRef))
]
