/** @see ../../docs/decisions/restore-parent-route-2026-11-17.md */
/** @see ../../docs/decisions/parent-review-pilot-2026-11-17.md */
/** @see ../../docs/decisions/adaptive-review-modes-2026-11-17.md */
/** Shared presentation contracts, used by native publication and the real UI Kit.
 * Semantic correctness still requires reading the original; a length check is not a review.
 * @see ../../docs/shared/design/task-presentation.md
 * @see ../../docs/modules/reviews/adaptive-problem-card.md#presentation-gate
 * @see ../../docs/modules/materials/material-clarification.md#request-presentation
 */
import {solutionBlocksErrors,solutionMethodErrors} from './solution-blocks.mjs'
const contract=(id,title,components,specRef,requiredFields,checks)=>({id,title,components,specRef,requiredFields,checks})
export const presentationContracts={
 'assignment-units':contract('assignment-units','Упражнения из назначенного оригинала',['AssignmentUnits','TaskDisclosure','MaterialReader','ParentTaskGuide','QuizCard','PhotoUploadControl','TaskWorkEvidence','ProblemTaskCard'],'docs/modules/assignments/source-units.md',['Точная запись МЭШ','Отдельные исходные единицы','Оригинал перед расшифровкой','Ролевая помощь и предъявление'],['Не менять ID, критерии и ответы','Не засчитывать соседний пункт по общему фото','Не раскрывать закрытый путь ребёнку']),
 'parent-review':contract('parent-review','Полный разбор родителю',['ReviewBrief','ParentTaskGuide','GuidanceStageContent','SolutionBlocks'],'docs/modules/reviews/parent-review.md',['Правильный ответ','Фактическая попытка','Точное различие','Полный метод и доказательства','Источник'],['Нет ученического задания вместо ответа','Ключ загружается только родителю','Баллы и история сохранены']),
 'assignment-clarification':contract('assignment-clarification','Уточнение назначения и выбор семьи',['PhotoHelpPanel','SubjectRequirementSwitch'],'docs/shared/design/student-review-step.md#assignment-clarification',['Что уточнил ребёнок','Проверенное объяснение','Ожидание либо решение родителя'],['Фото не требуется для текстового вопроса','Ребёнок не отменяет назначение','Решение семьи не меняет оценку']),
 'source-context':contract('source-context','Источник и точное назначение',['AssignmentBrief','SourceFragment'],'docs/modules/school-diary/day-page.md',['Точная запись','Назначенный оригинал','Граница известного'],['Источник не подменяется пересказом','Получение материала не означает выполнение']),
 'numbered-problem':contract('numbered-problem','Нумерованная задача',['ProblemTaskCard','ProblemStatement','ParentTaskGuide'],'docs/modules/reviews/adaptive-problem-card.md#presentation-gate',['Условие один раз','Отдельные данные и искомое каждого подпункта','Метод и переходы','Проверка'],['Нет полного условия в плитке Дано','Нет шаблонного Найти','Родительский ответ закрыт для ученика']),
 'written-response':contract('written-response','Письменный ответ и обоснование',['AssignmentBrief','ParentTaskGuide','WorkReview'],'docs/modules/reviews/subject-aware-guidance.md',['Назначенное действие','Источник и опора','Переходы рассуждения','Критерий результата'],['Предметный способ обоснования','Не выдумывать единственный допустимый ответ']),
 assessment:contract('assessment','Проверка понимания',['AssignmentBrief','QuizCard'],'docs/modules/assessments/assessment-decision-graph.md',['Точный материал','Вопрос','Собственный ответ','Проверка и адресная обратная связь'],['Тест покрывает назначение','Чтение не подменяет аудирование или исполнение']),
 'source-request':contract('source-request','Недостающий источник',['MaterialRequest','PhotoUploadControl'],'docs/modules/materials/material-clarification.md#request-presentation',['Что уже есть','Чего не хватает','Почему имеющееся не подходит','Где проверено','Одно действие'],['Не просить уже доступные страницы','Не повторять вопрос, предупреждение и статус']),
 organization:contract('organization','Подготовить, взять, сдать',['AssignmentBrief'],'docs/modules/assignments/README.md',['Действие','Срок','Отдельное подтверждение'],['Фото решения не подтверждает физическую сдачу']),
 information:contract('information','Информация без учебного долга',['AssignmentBrief'],'docs/modules/synchronization/plan-generation.md',['Точный текст','Отсутствие учебного действия'],['Не создавать тест и требование фото']),
 platform:contract('platform','Результат внешней платформы',['AssignmentBrief','WorkReview','PhotoUploadControl'],'docs/modules/school-diary/day-page.md',['Назначение','Собственный результат платформы'],['Тест Education не заменяет ЦДЗ']),
 'review-result':contract('review-result','Результат и следующий шаг',['WorkReview','ReviewConversation','ReviewBrief','ReviewActivity'],'docs/shared/design/compact-review.md',['Что принято','Точное место пробела','Опора','Один вопрос либо завершение'],['Сохраняются верные части','Наблюдение навыка не равно освоению']),
}
export function presentationContractForRule(rule){
 const {id='',product=''}=rule??{}
 const products={'source-linked-written-guide':'written-response','source-covered-quiz':'assessment','skill-covered-independent-diagnostic':'assessment','verified-material-purpose':'source-context','numbered-problems-and-private-solutions':'numbered-problem','source-covered-spelling-dictation':'assessment','comprehension-quiz-and-separate-oral-evidence':'assessment','speaking-content-and-oral-evidence':'assessment','audio-linked-assessment':'assessment','source-linked-project-route':'written-response','information-without-homework':'information','external-platform-evidence':'platform','dated-organisational-action':'organization','independent-action-products':'written-response','current-repetition-quiz-covering-this-part':'assessment'}
 const key=id==='math.problem'||id==='special.sheet'?'numbered-problem':products[product]
 if(!key)throw Error(`Нет утверждённого контракта представления продукта ${product}.`)
 return presentationContracts[key]
}
const norm=v=>typeof v==='string'?v.normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase('ru'):''
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max
const fields=(v,allowed)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k))
const genericFind=/^(?:результат и обоснование|результат|ответ|решение)(?:,? прямо запрошенн[а-яё ]* в условии)?[.!]?$/iu
function factUnitErrors(unit,original,path){
 const errors=[]
 if(!Array.isArray(unit?.facts)||!unit.facts.length)errors.push(`${path}.facts: нужны отдельные известные данные.`)
 else{
  if(new Set(unit.facts.map(f=>norm(f?.label))).size!==unit.facts.length)errors.push(`${path}.facts: подписи данных повторяются.`)
  for(const f of unit.facts){
   if(!fields(f,['label','value']))errors.push(`${path}.facts: разрешены только label и value.`)
   if(!text(f?.label,80)||!text(f?.value,160))errors.push(`${path}.facts: одна плитка содержит один краткий факт, а не абзац условия.`)
   if(original.length>80&&norm(f?.value)===original)errors.push(`${path}.facts: полное условие продублировано в Дано.`)
  }
 }
 if(!text(unit?.find,240)||genericFind.test(unit.find.trim()))errors.push(`${path}.find: назовите конкретное искомое, без шаблона «результат из условия».`)
 return errors
}
export function problemPresentationErrors(problem){
 const support=problem?.support,original=norm(problem?.original?.text)
 if(!support)return ['support: нужна проверенная модель данных и искомого.']
 if(support.parts!==undefined){
  if(!Array.isArray(support.parts)||support.parts.length<2||support.parts.length>12)return ['support.parts: каждый подпункт требует отдельную группу данных и искомое.']
  const errors=[]
  if(!Array.isArray(support.facts)||support.facts.length||support.find!=='')errors.push('support: общая плитка Дано/Найти не должна дублировать подпункты.')
  if(new Set(support.parts.map(p=>p?.id)).size!==support.parts.length)errors.push('support.parts: ID подпунктов повторяются.')
  for(const p of support.parts){if(!fields(p,['id','title','facts','find'])||!/^[a-z0-9-]+$/.test(p?.id??'')||!text(p?.title,100))errors.push('support.parts: нужны устойчивый ID, название и только публичные данные подпункта.');errors.push(...factUnitErrors(p,original,`support.parts.${p?.id??'invalid'}`))}
  return errors
 }
 return factUnitErrors(support,original,'support')
}
export function guidePresentationErrors(guide){
 const errors=[...solutionMethodErrors(guide?.method)]
 if(guide?.presentation==='math-route'&&!guide.method)errors.push('guide.method: математический путь требует названного метода и конкретных переходов.')
 if(Array.isArray(guide?.method?.steps)&&guide.method.steps.filter(s=>typeof s==='string'&&/^(?:выделить данные и цель|построить связи величин|выполнить действия и проверить полноту|проверить ответ по исходному условию)$/iu.test(s.trim())).length>1)errors.push('guide.method.steps: универсальные названия не заменяют переходы этой задачи.')
 for(const stage of guide?.stages??[]){
  if(!text(stage.expected,240))errors.push(`guide.${stage.id}.expected: первый уровень содержит краткую мысль; подробности идут в структурированные блоки.`)
  errors.push(...solutionBlocksErrors(stage.blocks))
  if(stage.blocks?.length&&stage.rows?.length)errors.push(`guide.${stage.id}: используйте blocks либо rows, без двух копий одного разбора.`)
  if(guide.presentation==='math-route'&&!stage.blocks?.length&&!stage.rows?.length)errors.push(`guide.${stage.id}: нет переходов решения.`)
 }
 return errors
}
export function materialRequestPresentationErrors(request){
 const p=request?.presentation
 if(!p||p.version!==1)return ['materialRequest.presentation: нужен общий макет запроса с известным, недостающим и причиной.']
 const errors=[]
 if(!fields(p,['version','available','missing','reason','action','checkedAt','checkedSources','coverage','continuation']))errors.push('materialRequest.presentation: неизвестные поля публичного представления запрещены.')
 for(const key of ['available','missing','checkedSources'])if(!Array.isArray(p[key])||!p[key].length||p[key].length>8||p[key].some(v=>!text(v,180)))errors.push(`materialRequest.presentation.${key}: нужны короткие отдельные пункты.`)
 for(const key of ['reason','action'])if(!text(p[key],240))errors.push(`materialRequest.presentation.${key}: нужна конкретная краткая формулировка.`)
 if(!text(p.checkedAt,40)||!Number.isFinite(Date.parse(p.checkedAt)))errors.push('materialRequest.presentation.checkedAt: нужна дата проверки библиотеки и архива.')
 if(Array.isArray(p.available)&&Array.isArray(p.missing)&&p.available.some(a=>p.missing.some(m=>norm(a)===norm(m))))errors.push('materialRequest: уже имеющийся материал нельзя одновременно запрашивать.')
 if(p.coverage){const c=p.coverage;if(!fields(c,['collectionId','availablePages','missingPages'])||!text(c.collectionId,100)||!['availablePages','missingPages'].every(k=>Array.isArray(c[k])&&c[k].every(n=>Number.isInteger(n)&&n>0))||Array.isArray(c.availablePages)&&Array.isArray(c.missingPages)&&c.availablePages.some(n=>c.missingPages.includes(n)))errors.push('materialRequest: запрашиваемые страницы пересекаются с уже имеющимися.')}
 if(p.continuation&&(!fields(p.continuation,['label','dayToken','taskId'])||!text(p.continuation.label,100)||!/^[-\w]{24,128}$/.test(p.continuation.dayToken??'')||!/^[-a-z0-9]+$/.test(p.continuation.taskId??'')))errors.push('materialRequest.continuation: нужна точная прежняя карточка, а не описание её поиска.')
 return errors
}
