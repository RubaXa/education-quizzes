/** Private operator decision catalog: products and checks, never generated answers.
 * @see ../docs/modules/synchronization/subject-decision-graph.md */
import { lessonSubjectKey } from '../day/subject-identity.mjs'
import { programmingAssignment, isControlAssignment, quizDecision } from '../assessment/decision-graph.mjs'
import { previousLessonReference } from '../assessment/lesson-repetition.mjs'
import { classifyMeshNotice } from '../day/mesh-notice.mjs'
const rule = (id, when, product, checks) => ({ id, when, product, checks, executor: 'agent-with-publisher-validation' })
const quiz = 'source-covered-quiz', written = 'source-linked-written-guide'
export const subjectDecisionProfiles = {
 math: { title:'Математика', rules:[
  rule('math.problem','Упражнение, задача, геометрия',written,['Полное условие, рисунок и каждый подпункт','Метод, обозначения, связи, полнота и единицы','Другой правильный способ и прежние зачёты сохраняются']),
  rule('math.theory','Теория, правило, повторение',quiz,['Назначенный навык, понимание и применение','Новый тест повторения не отменяет прежнюю письменную работу'])] },
 special: { title:'Спецкурс / практикум', rules:[
  rule('special.sheet','Учительский лист, номера или демовариант','numbered-problems-and-private-solutions',['Все исходные номера, варианты, рисунки и SHA файла','Реши сколько получится сохраняет выбор, не долг за все номера','Для каждого номера метод, модель, полный родительский путь; ребёнку безопасный шаг']),
  rule('special.theory','Теория или устное повторение',quiz,['Точный материал, не универсальные вопросы по математике','Подготовка листа и сдача тетради — разные действия'])] },
 russian: { title:'Русский язык', rules:[
  rule('russian.exercise','Письменное упражнение',written,['Достать полное условие из точного учебника','Отдельно каждый назначенный подпункт, не только номер']),
  rule('russian.vocabulary','Слова, словарный диктант','source-covered-spelling-dictation',['Полный назначенный список слов и точное написание','Диктант не подменяется тестом на выбор ответа']),
  rule('russian.rule','Правило, устное, повторение',quiz,['Понимание правила и применение к новым примерам','Устная часть отдельно от письменной']),
  rule('russian.analysis','Анализ текста или план',written,['Точный текст, микротемы и назначенный вид плана','Не выдумывать обязательное число частей']),
  rule('russian.essay','Сочинение',written,['Жанр, замысел, функции частей, связность','Собственный текст; содержание и грамотность отдельно']),
  rule('russian.retelling','Изложение',written,['Воспроизведение исходного текста, смысловые части и опорные слова','Не подменять сочинением на ту же тему'])] },
 literature: { title:'Литература', rules:[
  rule('literature.reading','Читать главы, пересказ, устные вопросы',quiz,['Ровно назначенные главы и эпизоды','Понимание, текстовые основания и интерпретация']),
  rule('literature.writing','Письменный ответ, отзыв, сочинение',written,['Позиция, эпизод или цитата и объяснение связи','Разные доказанные трактовки допустимы']),
  rule('literature.recitation','Стихотворение, выразительное чтение','comprehension-quiz-and-separate-oral-evidence',['Понимание проверяется тестом','Декламация и выразительность требуют отдельного свидетельства'])] },
 english: { title:'Английский язык', rules:[
  rule('english.exercise','Письменные упражнения учебника/тетради',written,['Точные издание, страница, действие и части каждого материала','Допустимые ответы; не считать невидимое на фото отсутствующим']),
  rule('english.production','Письмо, перевод, собственный текст',written,['Все содержательные критерии: тема, адресат, страна или иной явный признак','Язык и выполнение коммуникативной задачи проверяются отдельно']),
  rule('english.reading','Чтение и понимание',quiz,['Точный текст, смысл и применение языка','Не заменять listening чтением']),
  rule('english.vocabulary','Слова, словарный диктант','source-covered-spelling-dictation',['Полный назначенный список по всем упражнениям','Собственное написание без показанного слова; разбор каждой ошибки']),
  rule('english.speaking','Устный рассказ, диалог, говорение','speaking-content-and-oral-evidence',['Коммуникативная задача и все содержательные критерии','Собственная устная речь; чтение и грамотность её не заменяют']),
  rule('english.listening','Аудирование','audio-linked-assessment',['Именно назначенное аудио и упражнение','Текстовый тест не доказывает слуховое понимание'])] },
 history: { title:'История', rules:[
  rule('history.reading','Параграф, устное, повторение',quiz,['Факты, хронология, причины и применение по назначенному материалу','Не ограничиваться запоминанием дат']),
  rule('history.source','Письменная работа с источником',written,['Происхождение, тезис, доказательство и границы источника','Вывод подтверждён конкретным местом'])] },
 geography: { title:'География', rules:[
  rule('geography.reading','Текст, тема, повторение',quiz,['Понятия, причины, примеры и применение','Связь с назначенным параграфом']),
  rule('geography.map','Карта, таблица, данные',written,['Конкретная карта, легенда, наблюдение и вывод','Не выдумывать объект или обязательную таблицу'])] },
 biology: { title:'Биология', rules:[
  rule('biology.reading','Тема, параграф, повторение',quiz,['Структура, функция, классификация и применение','Проверять связи, не только названия']),
  rule('biology.structure','Выписка, рисунок, таблица или вопросы',written,['Каждое назначенное понятие и его функция/признак','Только назначенные сведения; эквивалентные формулировки допустимы'])] },
 informatics: { title:'Информатика', rules:[
  rule('informatics.code','Код, задача, программирование',written,['Трассировка, условия, циклы, границы и причина ошибки','Конечные примеры независимо выполнить; не запускать неизвестный бесконечный код']),
  rule('informatics.theory','Теория и подготовка',quiz,['Листинги, трассировка, debugging и перенос','Тема и язык подтверждены; оценка платформы отдельно'])] },
 technology: { title:'Труд / технология', rules:[
  rule('technology.product','Изделие, проект, практическая работа','source-linked-project-route',['Назначенные требования, план, процесс и собственный результат','Тест понимания не доказывает изготовление']),
  rule('technology.theory','Инструкция и теория',quiz,['Точная инструкция и правила безопасности','Программирование выбирается по содержанию и идёт в информатику'])] },
 generic: { title:'Другой предмет', rules:[
  rule('generic.written','Подтверждённое письменное/практическое действие',written,['Точное условие и применимый критерий','Не придумывать эталон, жанр или обязательный формат']),
  rule('generic.oral','Подтверждённое чтение, устное, повторение',quiz,['Точный материал и проверяемое содержание','Практический навык отдельно от процента теста'])] },
}
export function subjectDecisionPlan(task = {}, subject = 'generic', context = {}) {
 const key = programmingAssignment(task) ? 'informatics' : subject === 'practicum' ? 'special'
  : subjectDecisionProfiles[subject] ? subject : lessonSubjectKey(subject) ?? 'generic'
 const normalized = key === 'practicum' ? 'special' : key
 const profile = subjectDecisionProfiles[normalized] ?? subjectDecisionProfiles.generic
 const repetitionParts = previousLessonReference(task) && Array.isArray(task.repetition?.parts) ? task.repetition.parts : null
 const text = repetitionParts ? [task.meshText,...repetitionParts.map(part=>part.topic)].join(' ') : task.meshText ?? ''
 const hasTeacherFiles = context.hasTeacherFiles === true || task.materialStatus?.state === 'teacher-attachment-linked' || Boolean(task.sourceInventory?.sources?.length)
 const informational = !context.hasFamilyTask && Boolean(classifyMeshNotice(text,{hasTeacherFiles}))
 const organization = /(?:взять|сдать|принести|тетради\s+сдать)[^.\n]{0,100}(?:тетрад|лист|альбом|проверку)|тетради\s+сдать/iu.test(text)
 const writing = !repetitionParts && (task.kind === 'written' || ['written','worked-solution','text-structure','structured-notes'].includes(task.outputKind) || Boolean(task.problems?.length))
 const oral = Boolean(repetitionParts) || task.kind === 'read' || ['oral','reading'].includes(task.outputKind) || /повторить|устно|выучить|читать|прочитать|пересказ|слов[ао]рн.*диктант|прослушать|аудирован/iu.test(text)
  || !isControlAssignment(task) && quizDecision(task)?.job === 'prepare-quiz'
 const actions=[]
 const add = (action,ruleId) => {const r=profile.rules.find(x=>x.id===ruleId) ?? profile.rules[0]; actions.push({action,ruleId:r.id,product:r.product,checks:r.checks,executor:r.executor})}
 if (informational) actions.push({action:'information',ruleId:'common.information',product:'information-without-homework',checks:['Нет учебного действия и назначенного файла'],executor:'code-classification'})
 else if (task.kind === 'cdz' || task.outputKind === 'platform-result') actions.push({action:'platform',ruleId:'common.platform',product:'external-platform-evidence',checks:['Собственный факт выполнения платформы, не тест Education'],executor:'agent-with-publisher-validation'})
 else {
  if (writing) {
   const id=normalized==='russian' ? /изложени/iu.test(text)?'russian.retelling':/сочинени/iu.test(text)?'russian.essay':/план|анализ.*текст/iu.test(text)?'russian.analysis':'russian.exercise'
    : normalized==='english' ? /письмо|письма|перевод|блюд|собственн.*текст/iu.test(text)?'english.production':'english.exercise'
    : ({math:'math.problem',special:'special.sheet',literature:'literature.writing',history:'history.source',geography:'geography.map',biology:'biology.structure',informatics:'informatics.code',technology:'technology.product'})[normalized] ?? 'generic.written'
   add('written',id)
  }
  if (oral) {
   const id=normalized==='english' ? /диктант|слова|слов\s+/iu.test(text)?'english.vocabulary':/ауди|слуша|listening/iu.test(text)?'english.listening':/рассказ|диалог|говорени|speaking/iu.test(text)?'english.speaking':'english.reading'
    : normalized==='russian' && /диктант|выучить.*слов/iu.test(text)?'russian.vocabulary'
    : normalized==='literature' && /стих|выразительн/iu.test(text)?'literature.recitation'
    : ({math:'math.theory',special:'special.theory',russian:'russian.rule',literature:'literature.reading',history:'history.reading',geography:'geography.reading',biology:'biology.reading',informatics:'informatics.theory',technology:'technology.theory'})[normalized] ?? 'generic.oral'
   add('oral',id)
   if (normalized==='english' && id!=='english.listening' && /ауди|слуша|listening/iu.test(text)) add('listening','english.listening')
   if (normalized==='english' && id!=='english.speaking' && /рассказ|диалог|говорени|speaking/iu.test(text)) add('speaking','english.speaking')
  }
  if (hasTeacherFiles && !writing && !oral) actions.push({action:'classify-material',ruleId:`${normalized}.source-classification`,product:'verified-material-purpose',checks:['Прочитать весь файл: задачи, текст, критерии или уже выполненная работа','По содержимому выбрать номера с разбором либо тематический тест; файл сам по себе не готовый продукт'],executor:'agent-confirmation-required'})
  if (isControlAssignment(task)) actions.push({action:'control',ruleId:`${normalized}.control`,product:'skill-covered-independent-diagnostic',checks:['Тема и структура назначенного образца','Проверенная самостоятельная попытка, а не готовый разбор'],executor:'agent-with-publisher-validation'})
  if (organization) actions.push({action:'organization',ruleId:'common.organization',product:'dated-organisational-action',checks:['Подготовка, взять тетрадь и сдача имеют отдельные сроки','Физическое действие не подтверждается фото решения'],executor:'agent-confirmation-required'})
 }
 if (repetitionParts) {
  const templateActions=[...actions];actions.length=0
  for (const part of repetitionParts) {
   const match=templateActions.find(action=>/ауди|слуша|listening/iu.test(part.topic)?action.ruleId==='english.listening':/слова|диктант|vocabulary/iu.test(part.topic)?action.ruleId==='english.vocabulary':action.action==='oral') ?? templateActions[0]
   if (match) actions.push({...match,partId:part.id,product:'current-repetition-quiz-covering-this-part',sourceState:part.materialState==='ready'?'confirmed-part':'missing-part',sourceRef:part.materialRef})
  }
 }
 for (const action of actions) {
  const proof=context.partSources?.[action.partId ?? action.ruleId]
  action.sourceState ??= proof?.confirmed===true && typeof proof.ref==='string' && proof.ref.trim() ? 'confirmed-part' : actions.length>1 ? 'requires-source-for-this-part' : 'requires-content-verification'
  if (task.testToken && /quiz|assessment|dictation|diagnostic/u.test(action.product)) action.existingProductRef = task.testToken
 }
 return {subject:normalized,profile:profile.title,inputs:[
  {origin:'mesh',state:task.meshText?'present':'requires-review'},
  {origin:'uploaded-material',state:hasTeacherFiles?'linked-source-requires-content-review':'check-library-inbox-and-archive'},
  {origin:'parent-context',state:context.parentRefs?.length?'provided-for-explicit-merge':'review-current-and-recorded-parent-context'},
 ],actions,independentPreparation:actions.length>1?'explicit-source-and-identity-required-per-part':'single-action',instructionReviewed:task.instructionStatus?.state==='reviewed',sourceReadiness:task.instructionStatus?.state!=='reviewed'?'unreviewed': ['textbook-page-needed','teacher-attachment-needed'].includes(task.materialStatus?.state)?'missing-part':'instruction-confirmed-material-needs-verification',completionClaim:false,
 requiredChecks:['exact-source-and-all-parts','independent-action-readiness','preserve-credit-and-optionality','separate-parent-child-projections','both-role-readback']}
}
