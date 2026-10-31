import TaskAttachmentsExample from './ui-kit/TaskAttachmentsExample'
/** @see ../docs/decisions/compact-review-rollout-2026-10-31.md */
import { workFileTypes, workFilePresentation, workFileContentType } from '../storage/work-file-types.mjs'
/** @see ../docs/decisions/compact-review-ui-kit-2026-10-31.md */
/** @see ../docs/decisions/personal-tutoring-2026-10-30.md */
/** @see ../docs/decisions/ui-kit-photo-help-2026-10-27.md */
/** @see ../docs/decisions/ui-kit-written-practice-2026-10-27.md */
/** @see ../docs/decisions/upload-photo-timestamp-2026-10-21.md */
/** @see ../docs/decisions/collapsed-variant-status-2026-10-21.md */
/* @see ../docs/decisions/work-photo-expand-2026-10-18.md */
/* @see ../docs/decisions/upload-origin-links-2026-10-18.md */
/** @see ../docs/decisions/grade-average-ui-kit-2026-10-18.md */
/** @see ../docs/shared/design/ui-kit.md#school-grade-average */
/** @see ../docs/decisions/released-stage-parity-2026-10-20.md */
/** @see ../docs/decisions/calendar-scroll-selection-2026-10-28.md */
import AudioPlayer from '@/components/AudioPlayer'
import ReviewBriefShowcase from '@/components/ReviewBriefShowcase'
import { uiKitAudioLink, uiKitAudioResolver } from '@/lib/uiKitAudio'
import HomeworkOverview from '@/components/HomeworkOverview'
import DayCalendar from '@/components/DayCalendar'
import MaterialRequest from '@/components/MaterialRequest'
import PhotoUploadControl from '@/components/PhotoUploadControl'
import WorkFilePreview from '@/components/WorkFilePreview'
import OlympiadSourceQueue from '@/components/OlympiadSourceQueue'
import LinkedWorkPhotos from '@/components/LinkedWorkPhotos'
import WorkPhotoGallery from '@/components/WorkPhotoGallery'
import { tracePhotoHelp } from '@/lib/browserAccessTrace'
import ProblemTaskCard from '@/components/ProblemTaskCard'
import PhotoHelpRequest from '@/components/PhotoHelpRequest'
import OlympiadLesson, { type OlympiadLessonProjection } from '@/components/OlympiadLesson'
import OlympiadCatalog from '@/components/OlympiadCatalog'
import OlympiadPage from '@/components/OlympiadPage'
import OlympiadHistoryShowcase from '@/components/OlympiadHistoryShowcase'
import OlympiadReferences from '@/components/OlympiadReferences'
import { problemCardState } from '@/lib/reviewPresentation'
import type { DayPageData, DayProblem, DayUpload, DayWorkReview } from '@/lib/dayStore'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ProblemCard } from '@/components/ProblemCard'
import ProblemStatement from '@/components/ProblemStatement'
import { BellRing, BookOpen, ChevronRight, CircleHelp, Layers3, Palette, Paperclip } from 'lucide-react'
import ProblemGroup from '@/components/ProblemGroup'
import { PracticeVariantStatus } from '@/components/PracticeVariantStatus'
import RequirementSwitch from '@/components/RequirementSwitch'
import { ResultBadge, ResultMeter, ResultPoints } from '@/components/ui/result'
import QuizCard from '@/components/QuizCard'
import { olympiadPracticeTheory } from '@/lib/olympiadPracticeTheory'
import GradeAverage from '@/components/GradeAverage'
import GradeAverageSlider from '@/components/GradeAverageSlider'
import TelegramNotificationPreview from '@/components/TelegramNotificationPreview'
import ParentTaskGuide from '@/components/ParentTaskGuide'
import TaskGuidance from '@/components/TaskGuidance'
import type { ParentTaskGuide as Guide } from '@/lib/dayStore'
import { projectGuidanceReveal } from '../day/guidance-release.mjs'
import { uiKitQuizExamples, uiKitHomeworkRows, uiKitCalendar, uiKitCalendarDays } from '@/lib/uiKitExamples'
import type { ResultInput } from '@/lib/resultPresentation'
import tokenCss from './education-design-tokens.css?raw'
import './UiKit.css'
import './DayPage.css'

const demoSharedPhoto: DayUpload = { id: 'demo:shared-photo', taskId: 'demo-p1', coveredTaskIds: ['demo-p1', 'demo-p2', 'demo-p3'], status: 'reviewed',
  createdAt: '2026-10-20T10:03:00.000Z',
  dataUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240"><rect width="400" height="240" fill="white"/><text x="25" y="60" font-size="24">Пример: № 1, № 2, № 3</text><path d="M25 100h300m-300 40h250m-250 40h280" stroke="#70698b" stroke-width="3"/></svg>')}` }
const demoPhotoPage = { subjects: [{ tasks: [{ id: 'demo-sheet', title: 'Условный лист', problems: [{ id: 'demo-p1', number: 1, title: 'Место загрузки' }] }] }] } as DayPageData
const writtenDemoPhoto = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240"><rect width="400" height="240" fill="white"/><text x="24" y="55" font-size="24">Красных — 3</text><text x="24" y="100" font-size="24">Синих — на 2 больше</text><text x="24" y="145" font-size="24">3 + 2 = 5</text><path d="M24 175h250" stroke="#70698b" stroke-width="3"/></svg>')}`
const writtenProblemDemo: DayProblem = { id: 'demo-written', number: 1, title: 'Письменная задача · пример', detail: '', source: 'Условный пример UI Kit', original: { text: 'В коробке 3 красных карандаша, а синих на 2 больше. Сколько всего карандашей?', attachmentRef: 'demo-only' } }
const writtenReviewDemo: DayWorkReview = { id: 'demo-written-review', taskId: writtenProblemDemo.id, status: 'partial', uploadIds: ['written-2'], studentFeedback: { title: 'Синих найдено · решение не завершено', confirmed: 'Ты верно нашёл количество синих карандашей: 3 + 2 = 5.', focus: 'Общее количество включает обе группы: красные и синие карандаши. Число синих ты уже нашёл; теперь надо объединить две группы, а не ещё раз искать разность.', question: 'Какое действие объединит 3 красных и 5 синих карандашей?', steps: [{ stageId: 'blue-count', uploadId: 'written-2', location: 'первая строка решения', observation: '3 + 2 = 5', explanation: 'Ты верно прибавил разницу к числу красных карандашей и получил число синих.', status: 'correct' }] }, history: [{ status: 'needs-fix', studentFeedback: { title: 'Нужна правка', confirmed: 'Начало записано.', focus: 'Проверь следующий переход.', question: 'Что следует из условия?' } }] }
const writtenUploadsDemo: DayUpload[] = [1, 2].map((number) => ({ id: `demo:written-${number}`, taskId: writtenProblemDemo.id, status: 'reviewed', createdAt: `2026-10-${19 + number}T10:03:00.000Z`, dataUrl: writtenDemoPhoto }))
// Synthetic family data for the same page adapter; no network or real family data.
const demoOlympiadSelections: typeof import('@/lib/educationStore').watchOlympiadSelections = (_f,_c,next) => { next(['demo']); return () => {} }
const demoOlympiadCatalog: typeof import('@/lib/educationStore').watchPublicOlympiads = next => { next([{ id: 'demo', title: 'Математическая олимпиада · пример', deadline: null, gradeLevels: [6] }]); return () => {} }
const demoOlympiadTasks: typeof import('@/lib/educationStore').watchFamilyOlympiadTasks = (_family, _child, next) => {
  next([{ id: 'demo-task', title: 'Условная задача', dueDate: '2026-11-05', projectionSourceDate: '2026-11-04', learningContext: { kind: 'olympiad', id: 'demo' }, testTokens: ['demo-test'] }, { id: 'demo-task-2', title: 'Ещё одна задача', dueDate: '2026-11-05', projectionSourceDate: '2026-11-04', learningContext: { kind: 'olympiad', id: 'demo' }, testTokens: [] }, { id: 'demo-uploaded', title: 'Задача с фотографии', dueDate: '2026-11-05', projectionSourceDate: '2026-11-04', learningContext: { kind: 'olympiad', id: 'demo' }, testTokens: [], sourcePhotoIds: ['demo-photo'], competitionNumber: 1 }]); return () => {}
}
function demoOlympiadDashboard(role: 'parent' | 'student'): typeof import('@/lib/dayDashboardStore').watchDayDashboard {
  return (_token, next) => { next({ schemaVersion: 1, kind: role, today: '2026-11-04', timezone: 'Europe/Moscow', days: [{ date: '2026-11-04', checkedAt: null, complete: true, schedule: [], homework: [], dayToken: 'demo-day' }] }); return () => {} }
}
const demoOlympiadParentDashboard = demoOlympiadDashboard('parent')
const demoOlympiadStudentDashboard = demoOlympiadDashboard('student')
const variantStatusDemo = [
  { id: 'demo-verified', title: 'Вариант A · пример', problem: { id: 'demo-variant-a1', number: 7, title: 'Условная задача 7', detail: '', source: 'Пример UI Kit' }, status: 'verified' as const },
  { id: 'demo-fix', title: 'Вариант B · пример', problem: { id: 'demo-variant-b1', number: 8, title: 'Условная задача 8', detail: '', source: 'Пример UI Kit' }, status: 'needs-fix' as const },
]
const guidanceDemo: Guide = { kind: 'worked-solution', presentation: 'math-route', routeProfile: 'standard', revision: 2,
  overview: 'Пример полного раскрытия выбранного этапа', stages: [{ id: 'given', title: 'Прямая и направления', role: 'calculation',
    expected: 'Переходы ±1, ±2, ±4, ±8, ±16 дм', rows: [{ label: 'Симметрия', value: 'Можно считать последний переход равным +16' }],
    why: 'Парные переходы равны по длине и направлены в противоположные стороны.', hintPreview: 'Сравни длины парных переходов.',
    revealPreview: 'Учитывай направление каждого перехода: равные по длине отрезки могут иметь разные знаки.',
    source: { kind: 'teacher-file', label: 'Лист учителя №2', ref: 'demo-only:teacher-sheet', excerpt: 'Демонстрационный источник' } }] }

const fileExamples = Object.entries(workFileTypes).map(([contentType, [extension]]) => ({ contentType, originalName: `Пример.${extension}`, preview: contentType.startsWith('image/') ? writtenDemoPhoto : undefined }))
const fileIconExamples = fileExamples.filter((file, index) => fileExamples.findIndex(other => workFilePresentation(other).kind === workFilePresentation(file).kind) === index)

const topicGroups = [
  {id:'foundations',title:'Основы',topics:[
    {id:'tokens',title:'Цвета и токены',icon:Palette},
  ]},
  {id:'components',title:'Компоненты',topics:[
    {id:'results',title:'Индикаторы результата',icon:CircleHelp},
    {id:'compact-review',title:'Компактный разбор',icon:BookOpen},
    {id:'grades',title:'Средний балл',icon:CircleHelp},
    {id:'files',title:'Файлы и превью',icon:Paperclip},
  ]},
  {id:'scenarios',title:'Составные сценарии',topics:[
    {id:'calendar',title:'Календарь и каникулы',icon:BookOpen},
    {id:'homework',title:'Сводка ДЗ',icon:BookOpen},
    {id:'material',title:'Уточнение материала',icon:BookOpen},
    {id:'audio',title:'Аудиоплеер',icon:BookOpen},
    {id:'photos',title:'Связанные фото',icon:BookOpen},
    {id:'written',title:'Письменная задача',icon:BookOpen},
    {id:'olympiad-catalog',title:'Список олимпиад',icon:BookOpen},
    {id:'olympiad-page',title:'Страница олимпиады',icon:BookOpen},
    {id:'olympiad-history',title:'История олимпиад',icon:BookOpen},
    {id:'olympiad-lesson',title:'Игровой урок',icon:BookOpen},
    {id:'guidance',title:'Подсказка и раскрытие',icon:BookOpen},
    {id:'quiz',title:'История тестов',icon:Layers3},
    {id:'telegram',title:'Telegram-уведомления',icon:BellRing},
  ]},
] as const
type UiKitSection = (typeof topicGroups)[number]['topics'][number]['id']
const colourRoles = [
  ['success','Зачтено','85–100% проверенных баллов'],['attention','Нужно повторить','50–менее 85%'],['error','Нужна тренировка','Менее 50%'],
  ['waiting','Ожидание','Результат ещё не проверен'],['accent','Выполнение','Заполняются ответы'],['neutral','Неизвестно','Данных для результата нет'],
] as const
const coreTokens: Record<string,string> = {
  '--edu-calendar-vacation-bg':'Фон подтверждённого периода каникул', '--edu-calendar-vacation-border':'Контур каникульного периода', '--edu-calendar-vacation-ink':'Текст и знак каникул; не оценка результата',
  '--edu-canvas':'Фон страницы', '--edu-surface':'Поверхность карточки', '--edu-ink':'Основной текст', '--edu-text-primary':'Основной текст, смысловой псевдоним',
  '--edu-muted':'Вторичный текст', '--edu-text-secondary':'Вторичный текст, смысловой псевдоним', '--edu-brand':'Фирменный акцент Education', '--edu-accent-ink':'Второстепенное действие и ссылка',
  '--edu-primary-bg':'Фон основной кнопки','--edu-primary-ink':'Текст основной кнопки','--edu-control-border':'Контур контрола','--edu-card-border':'Разделитель или контур карточки',
  '--edu-focus':'Видимый клавиатурный фокус','--edu-hover':'Наведение и выбранная строка','--edu-radius-card':'Скругление карточки','--edu-radius-control':'Скругление контрола','--edu-touch-target':'Общая область нажатия',
  '--edu-result-meter-height':'Высота полосы результата','--edu-result-meter-compact-height':'Высота полосы в таблице','--edu-quiz-row-padding':'Вертикальный отступ строки истории','--edu-quiz-meta-gap':'Промежуток между названием и данными','--edu-quiz-touch-target':'Область нажатия строки и часов',
}
for (const [role,label] of colourRoles) {
  coreTokens[`--edu-status-${role}-bg`] = `${label}: светлый фон метки и трека`
  coreTokens[`--edu-status-${role}-ink`] = `${label}: контрастный текст, знак и заполнение`
}
const tokenDefinitions = [...tokenCss.matchAll(/(--edu-[\w-]+):\s*([^;]+);/g)].map(([,name,value]) => ({name,value}))
function tokenMeaning(name: string) {
  if (coreTokens[name]) return coreTokens[name]
  if (name.startsWith('--edu-problem-')) {
    const roles:Record<string,string>={'border':'Граница задачи','heading':'Заголовок задачи','text':'Текст условия','number-ink':'Номер задачи','transcript-border':'Граница расшифровки','source-ink':'Подпись источника','education-bg':'Фон блока Дано / Найти','fact-label':'Подпись величины в Дано','find-bg':'Фон искомого','find-label':'Подпись Найти','find-ink':'Значение искомого','help-border':'Граница подсказки','help-focus':'Фокус подсказки','help-bg':'Фон помощи','help-form-border':'Граница формы помощи','help-selected-border':'Граница выбранного уровня помощи','help-accent':'Акцент помощи','help-ink':'Текст помощи','help-muted':'Вторичный текст помощи','rationale-ink':'Обоснование решения','missing-ink':'Подпись отсутствующих данных','question-ink':'Текст вопроса ребёнку','error-ink':'Ошибка работы'}
    return `${roles[name.slice('--edu-problem-'.length)] ?? 'Слой нумерованной задачи'}. Относится к предметной карточке, не к результату теста.`
  }
  if (name.startsWith('--edu-success-')) return 'Базовая зелёная пара, на неё ссылается смысловой статус success'
  if (name.startsWith('--edu-warning-')) return 'Базовая янтарная пара и контур для статуса attention'
  if (name.startsWith('--edu-waiting-')) return 'Базовая голубая пара для статуса waiting'
  if (name.startsWith('--edu-danger-')) return 'Базовая красная пара и контур для статуса error'
  if (name === '--edu-bell-ink') return 'Цвет значка общего колокольчика'
  if (name === '--edu-ink-dashboard') return 'Текст панели расписания'
  return 'Специализированный токен текущей дизайн-системы'
}

/** Small living documentation page. Examples import the shipped components and never access family data.
 * @see ../docs/shared/design/ui-kit.md */
export default function UiKit() {
  const [section,setSection] = useState<UiKitSection>('results')
  const [points,setPoints] = useState(34)
  const [max,setMax] = useState(39)
  const [fileExample,setFileExample] = useState(fileExamples.find(file => file.contentType === 'application/pdf')!)
  const [state,setState] = useState('score')
  const [demoTarget,setDemoTarget] = useState('')
  const [demoFiles,setDemoFiles] = useState<string[]>([])
  const [demoDate,setDemoDate] = useState('2026-10-24')
  const [demoVariantRequired,setDemoVariantRequired] = useState(false)
  const [writtenParent,setWrittenParent] = useState(false)
  const [writtenUploads,setWrittenUploads] = useState<DayUpload[]>(writtenUploadsDemo)
  const [helpSelected,setHelpSelected] = useState<string[]>([])
  const [helpOpen,setHelpOpen] = useState(false)
  const [helpSubmitted,setHelpSubmitted] = useState<string[]>([])
  const [helpNote,setHelpNote] = useState('')
  const [helpSentNote,setHelpSentNote] = useState('')
  const [helpStatus,setHelpStatus] = useState<'draft'|'pending'|'ready'>('draft')
  const [helpResponseCount,setHelpResponseCount] = useState(0)
  const [catalogParent,setCatalogParent] = useState(true)
  const [catalogSelection,setCatalogSelection] = useState<string[]>([])
  const [lessonDemo,setLessonDemo] = useState<OlympiadLessonProjection>({title:'Учимся упорядочивать перебор · пример',status:'active',currentStep:1,stepCount:1,step:{id:'demo-step',prompt:'Нужно найти все двузначные числа из цифр 1 и 2. Как не пропустить варианты?',options:[{id:'demo-a',text:'Сначала перебрать числа с первой цифрой 1, затем с первой цифрой 2.'},{id:'demo-b',text:'Записать первое пришедшее в голову число и остановиться.'}]}})
  const documentUrls = useRef<string[]>([])
  useEffect(() => () => documentUrls.current.forEach(url => URL.revokeObjectURL(url)), [])
  function addWrittenPhotos(files: File[], selectForHelp = false) {
    const added = files.map((file, index) => {
      const contentType = workFileContentType(file)
      const dataUrl = contentType.startsWith('image/') ? writtenDemoPhoto : URL.createObjectURL(file)
      if (dataUrl.startsWith('blob:')) documentUrls.current.push(dataUrl)
      return { id: `demo:written-${writtenUploads.length + index + 1}`, taskId: writtenProblemDemo.id, status: 'pending' as const, originalName: file.name, contentType, dataUrl }
    })
    setWrittenUploads(current => [...current, ...added])
    if (selectForHelp) { setHelpSelected(current => [...current, ...added.map(photo => photo.id)]); tracePhotoHelp('photos-added', 'demo', 'student', {count: added.length}) }
  }
  function submitHelpDemo() {
    setHelpSubmitted(current => [...new Set([...current, ...helpSelected])])
    setHelpSentNote(current => helpNote.trim() ? [current, helpNote].filter(Boolean).join(' · ') : current)
    setHelpNote('')
    setHelpSelected([])
    setHelpStatus('pending')
    tracePhotoHelp('submitted', 'demo', 'student', {count: helpSelected.length, hasNote: Boolean(helpNote.trim())})
    tracePhotoHelp('waiting', 'demo', 'student')
  }
  const input:ResultInput = state==='score' ? {kind:'score',points,maxPoints:max} : state==='answers' ? {kind:'answers',answered:points,total:max} : {kind:state==='waiting'?'waiting':'unknown'}
  return <div className="edu-kit">
    <header className="edu-kit-intro"><span><BookOpen size={18} aria-hidden="true" /> Education UI Kit</span><h1>Компоненты и правила</h1><p>Живые компоненты приложения, их состояния и смысл токенов. Каталог расширяется по мере унификации интерфейса.</p><a href="#/">На главную</a></header>
    <div className="edu-kit-layout"><nav aria-label="Разделы UI Kit">{topicGroups.map(group => <div className="edu-kit-nav-group" key={group.id}><small>{group.title}</small>{group.topics.map(topic => <button key={topic.id} type="button" aria-current={section===topic.id?'page':undefined} onClick={()=>setSection(topic.id)}><topic.icon size={16} aria-hidden="true" />{topic.title}<ChevronRight size={14} aria-hidden="true" /></button>)}</div>)}</nav>
    <div className="edu-kit-content">
      {section==='compact-review' && <ReviewBriefShowcase />}
      {section==='audio' && <section aria-label="Пример аудиоплеера"><h2>Аудиоплеер</h2><p>Условный короткий звук. Тот же компонент используется в библиотеке и заданиях. Плеер виден сразу. Нажатие ▶ загружает и запускает запись. Одна округлая панель54px сохраняется после загрузки. Текущая скорость видна рядом со звуком: нажмите «1×», чтобы заранее выбрать0,5× или0,75×. Значок динамика открывает громкость.</p><AudioPlayer link={uiKitAudioLink} resolver={uiKitAudioResolver} /><AudioPlayer link={{ ...uiKitAudioLink, title: 'Пример недоступной записи' }} resolver={async () => { throw new Error('Демонстрация ошибки') }} /></section>}
      {section==='calendar' && <section aria-label="Пример календаря"><h2>Календарь и каникулы</h2><p>Условный пример, не календарь семьи. В приложении периоды приходят только из МЭШ конкретного ученика. Пустое расписание не означает каникулы.</p><DayCalendar days={uiKitCalendarDays} schoolCalendar={uiKitCalendar} today="2026-10-24" selectedDate={demoDate} onSelect={setDemoDate}/><p role="status">Выбрана дата: {demoDate}</p><p>При открытии выбранный день ставится по центру; выбор рядом не двигает полосу, а дата у края плавно перемещается к центру. Это тот же компонент, что в кабинете ученика и родителя. Период объединён рамкой, знаком солнца и подписью. Текущий день сохраняет контур, выбранный — фирменное заполнение. Любой день доступен для просмотра работ; каникулы не закрывают и не удаляют задания.</p></section>}
      {section==='results' && <section aria-labelledby="kit-results-title"><h2 id="kit-results-title">Индикаторы результата</h2><p>Метка, баллы и полоса используют одну политику цвета. Заполнение ответов и ожидание проверки — самостоятельные состояния.</p>
        <h3>Статусы свёрнутых вариантов · примеры</h3><p>Синтетические данные проходят через общий компонент группы. Выбор в переключателе не меняет статус проверки.</p>
        {variantStatusDemo.map((example) => {
          const uploads = [{ id: `demo:${example.id}`, taskId: example.problem.id, status: 'reviewed' as const }]
          const reviews = [{ id: `review:${example.id}`, taskId: example.problem.id, status: example.status, uploadIds: [example.id] }]
          return <div className="edu-kit-grade-examples" key={example.id}><ProblemGroup id={example.id} title={example.title} problems={[example.problem]} requiredProblems={[]} uploads={uploads} reviews={reviews} localPendingCount={0} sourceCount={0} ready><details className="day-practice-variant" open><summary><strong>{example.title}</strong><PracticeVariantStatus problems={[example.problem]} reviews={reviews} uploads={uploads} decisions={[]} /></summary><p>Условное решение из комплекта UI Kit.</p></details></ProblemGroup><RequirementSwitch checked={demoVariantRequired} onChange={setDemoVariantRequired} label={`Учитывать «${example.title}» в семейном плане`} /></div>
        })}
        <div className="edu-kit-playground"><div className="edu-kit-controls"><label>Состояние<select value={state} onChange={event=>setState(event.target.value)}><option value="score">Проверенный результат</option><option value="answers">Заполнение ответов</option><option value="waiting">Ожидание проверки</option><option value="unknown">Нет результата</option></select></label><label>{state==='answers'?'Ответов':'Баллов'}<input type="number" step="0.01" value={Number.isNaN(points)?'':points} disabled={state==='waiting'||state==='unknown'} onChange={event=>setPoints(event.target.valueAsNumber)} /></label><label>Всего<input type="number" min="1" step="0.01" value={Number.isNaN(max)?'':max} disabled={state==='waiting'||state==='unknown'} onChange={event=>setMax(event.target.valueAsNumber)} /></label></div>
        <div className="edu-kit-presets" aria-label="Примеры значений">{[0,50,84.99,85,100].map(value=><button type="button" key={value} onClick={()=>{setPoints(value);setMax(100);setState('score')}}>{value}%</button>)}</div>
        <div className="edu-kit-result-example" aria-live="polite"><ResultBadge input={input} showPoints /><div>{state==='score' && <ResultPoints points={points} maxPoints={max} />}</div><ResultMeter input={input} label={state==='answers'?'Доля заполненных ответов':'Процент набранных баллов'} /></div></div>
        <h3>Когда использовать</h3><ul><li><b>Метка результата:</b> процент в компактном списке или заголовке. Цвет дополняется числом и знаком.</li><li><b>Баллы:</b> набрано / максимум. Это не число полностью верных вопросов.</li><li><b>Полоса результата:</b> фактическая доля баллов; 0% остаётся пустой полосой с видимой меткой.</li><li><b>Заполнение:</b> пять ответов из пяти ещё не означают пять верных ответов. Поэтому полный черновик фиолетовый.</li><li><b>Ожидание:</b> без фиктивных 0% и без полосы результата.</li></ul>
        <h3>Границы</h3><p>Зачёт — от 85%. Янтарный — от 50% до порога зачёта. Красный — ниже 50%. Сравнение выполняется до округления: 84,99% не превращается в зелёные 85%. Эти границы относятся к тестам; школьный средний не переводится в проценты.</p>
      </section>}
      {section==='files' && <section aria-labelledby="kit-files-title" className="edu-kit-files">
        <h2 id="kit-files-title">Файлы и превью</h2>
        <p>Изображение показываем самим превью. Для файлов без доступного просмотра используем значок формата из Lucide React.</p>
        <div className="edu-kit-file-families" aria-label="Превью изображения и значки документов">{fileIconExamples.map(file => <div key={file.contentType}><WorkFilePreview file={file} href={file.preview} /><span>{workFilePresentation(file).label}</span></div>)}</div>
        <h3>Все поддерживаемые форматы</h3>
        <p>Выбери формат, чтобы увидеть раскрытое вложение. Это тот же компонент, что в загруженных решениях.</p>
        <div className="edu-kit-file-formats" aria-label="Форматы вложений">{fileExamples.map(file => <button type="button" key={file.contentType} aria-label={`Показать ${workFilePresentation(file).extension.toUpperCase()}`} aria-pressed={fileExample.contentType === file.contentType} onClick={() => setFileExample(file)}><WorkFilePreview file={file} compact href={file.preview} /><span>{workFilePresentation(file).extension.toUpperCase()}</span></button>)}</div>
        <div className="edu-kit-file-expanded" aria-label="Раскрытое вложение"><WorkFilePreview file={fileExample} href={fileExample.preview} /></div>
        <p>Фото открывается как изображение. Пока оно загружается или если произошла ошибка, показываем состояние загрузки и повтор, без значка типа файла.</p>
        <code>WorkFilePreview · общие токены --edu-* · источник форматов workFileTypes</code>
        <TaskAttachmentsExample problem={writtenProblemDemo} photoSource={writtenDemoPhoto} />
      </section>}
      {section==='grades' && <section aria-labelledby="kit-grades-title"><h2 id="kit-grades-title">Шкала среднего балла</h2><p>Фиксированные примеры показывают ключевые рубежи, а отдельный слайдер позволяет проверить каждый промежуточный балл от 2 до 5.</p>
        <h3>Примеры диапазонов</h3><div className="edu-kit-grade-examples" aria-label="Фиксированные примеры среднего балла">{[
          {value:'2,00',tone:'error' as const,label:'Диапазон двоек · нужна поддержка'},
          {value:'3,00',tone:'attention' as const,label:'Начало диапазона троек'},
          {value:'4,00',tone:'neutral' as const,label:'Диапазон четвёрок'},
          {value:'4,50',tone:'accent' as const,label:'Уже хорошо'},
          {value:'4,60',tone:'success' as const,label:'Устойчиво высокий средний'},
          {value:'5,00',tone:'success' as const,label:'Все отметки — пятёрки',excellent:true},
        ].map(item=><div key={item.value}><GradeAverage value={item.value} tone={item.tone} excellent={item.excellent}/><span>{item.label}</span></div>)}</div>
        <GradeAverageSlider />
        <h3>Пограничные значения</h3><div className="edu-kit-grade-boundaries"><span>2,99 <b>→</b> 3,00</span><span>3,99 <b>→</b> 4,00</span><span>4,49 <b>→</b> 4,50</span><span>4,59 <b>→</b> 4,60</span><span>4,99 <b>→</b> 5,00</span></div>
        <ol><li><b>2,00–2,99:</b> красный <code>error</code> — заметный сигнал, что по предмету нужна помощь.</li><li><b>3,00–3,99:</b> янтарный <code>attention</code> — средний на уровне троек.</li><li><b>4,00–4,49:</b> спокойный <code>neutral</code> — четвёрочный диапазон ниже выбранного рубежа «хорошо».</li><li><b>4,50–4,59:</b> фиолетовый <code>accent</code> — уже хорошо; до следующего ориентира ещё есть шаг.</li><li><b>4,60–4,99:</b> зелёный <code>success</code> — устойчиво высокий средний.</li><li><b>5,00 + allFives:</b> ✨ после числа — все отметки в срезе пятёрки.</li></ol>
        <p>Это визуальная шкала сохранённого среднего, не нормативная формула годовой отметки. Границы 4,50 и 4,60 показывают выбранные ориентиры; «твёрдую пятёрку» нельзя обещать без подтверждённых школьных правил. Подробное основание: <a href="https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html">W3C о цвете</a>, <a href="https://www.carbondesignsystem.com/building-blocks/core/patterns/status-indicators">Carbon об индикаторах</a> и <a href="https://design-system.service.gov.uk/components/tag/">GOV.UK о цветовых метках</a>. Уровень риска <code>watch</code> в реальных данных сохраняет приоритет. Изменения ползунка, watch и allFives действуют только в демонстрации.</p>
        <h3>Декомпозиция</h3><p><code>GradeAverageSlider</code> меняет значение локально, <code>gradeAverageTone</code> выбирает действующий цветовой токен, <code>GradeAverage</code> показывает число и явный знак всех пятёрок. DayPage/DayDashboard сохраняют управление оценкой, источник, watch-сигнал и раскрытие; UI Kit не записывает данные семьи.</p></section>}
      {section==='tokens' && <section aria-labelledby="kit-tokens-title"><h2 id="kit-tokens-title">Цвета и токены</h2><p>Базовое значение → смысловая роль → компонент. Компонент берёт цвет по смыслу, например success, а не выбирает свой зелёный.</p><div className="edu-kit-roles">{colourRoles.map(([role,label,description])=><div key={role} className={`edu-result-tone-${role}`}><span className="edu-kit-swatch" /><strong>{label}</strong><small>{description}</small><code>--edu-status-{role}-bg / ink</code></div>)}</div>
      <h3>Текущие CSS-токены</h3><p>Значения ниже получены из общего файла приложения. Изменение токена обновляет примеры и потребителей одновременно.</p><dl className="edu-kit-token-list">{tokenDefinitions.map(token=><div key={token.name}><dt><code>{token.name}</code><span className="edu-kit-token-preview" style={{background:token.name.endsWith('-bg')||token.name.endsWith('-ink')||token.name==='--edu-canvas'?`var(${token.name})`:undefined}} aria-hidden="true" /></dt><dd><code>{token.value}</code><p>{tokenMeaning(token.name)}</p></dd></div>)}</dl>
      </section>}
      {section==='photos' && <section aria-label="Пример связанных фото"><h2>Связанные фото</h2><p>Условный снимок содержит решения трёх задач. Файл остаётся в задаче № 1. В остальных — только ссылки для просмотра, без повторной загрузки или удаления.</p><h3>№ 1. Место загрузки</h3><WorkPhotoGallery compact taskTitle="Общий снимок" studentToken="demo" uploads={[demoSharedPhoto]} localPhotos={[]} now={0} /><h3>№ 2. Решение найдено на общем фото</h3><LinkedWorkPhotos taskId="demo-p2" uploads={[demoSharedPhoto]} pages={[demoPhotoPage]} /><h3>№ 3. Другое решение на том же фото</h3><LinkedWorkPhotos taskId="demo-p3" uploads={[demoSharedPhoto]} pages={[demoPhotoPage]} /></section>}
      {section==='written' && <section aria-label="Пример письменной задачи"><h2>Письменная задача и запрос помощи</h2>
        <p>Интерактивный макет на общих компонентах. Все данные условные: файлы не читаются и не отправляются, проверка и ответ имитируются локально.</p>
        <div className="edu-kit-presets" aria-label="Роль в примере"><button type="button" aria-pressed={!writtenParent} onClick={()=>{setWrittenParent(false);tracePhotoHelp('role-changed','demo','student')}}>Ученик</button><button type="button" aria-pressed={writtenParent} onClick={()=>{setWrittenParent(true);tracePhotoHelp('role-changed','demo','parent')}}>Родитель</button></div>
        <ProblemTaskCard problem={writtenProblemDemo} state={problemCardState(writtenUploads, writtenReviewDemo)} links={[]} parent={writtenParent} review={writtenReviewDemo} uploads={writtenUploads} helpAccess="ready" onPhotos={files=>addWrittenPhotos(files)}>
          <PhotoHelpRequest parent={writtenParent} status={helpStatus} selectedCount={helpSelected.length} note={writtenParent ? helpSentNote : helpNote} onNote={setHelpNote} onOpenChange={open=>{setHelpOpen(open);tracePhotoHelp(open ? 'opened' : 'closed','demo',writtenParent ? 'parent' : 'student');if(open && helpResponseCount>0) tracePhotoHelp('answer-opened','demo',writtenParent ? 'parent' : 'student')}} onPhotos={files=>addWrittenPhotos(files,true)} onSubmit={submitHelpDemo}
            response={helpResponseCount > 0 ? 'Ты верно нашёл количество синих карандашей: 3 + 2 = 5. Следующий шаг: сложи красные и синие карандаши: 3 + 5 = 8. Мы складываем их, потому что нужно найти общее количество.' : undefined}
            previousResponse={helpResponseCount > 1 ? 'Предыдущая подсказка: запиши отдельно, что известно из условия.' : undefined}
            attachedDescription={writtenUploads.flatMap((photo,index)=>helpSubmitted.includes(photo.id) ? [`Фото ${index+1}`] : []).join(', ')}
            photos={<WorkPhotoGallery taskTitle={writtenProblemDemo.title} studentToken="demo" uploads={writtenUploads} localPhotos={[]} review={writtenReviewDemo} now={Date.now()} evidenceLabel={!writtenParent && helpOpen ? 'Выбери фото для помощи' : 'Фото работы'} selection={!writtenParent && helpOpen ? {selectedIds:helpSelected,onChange:ids=>{setHelpSelected(ids);tracePhotoHelp('selection-changed','demo','student',{count:ids.length})},isSelectable:id=>helpStatus !== 'ready' || !helpSubmitted.includes(id)} : undefined} />}
          />
        </ProblemTaskCard>
        {helpStatus === 'pending' && <p><button className="problem-statement-help-button" type="button" onClick={()=>{setHelpStatus('ready');setHelpResponseCount(count=>count+1);tracePhotoHelp('answer-ready','demo',writtenParent ? 'parent' : 'student');if(helpOpen) tracePhotoHelp('answer-opened','demo',writtenParent ? 'parent' : 'student')}}>Показать условный ответ после синхронизации</button> · управление только для макета</p>}
        <h3>Раскрытый список задач олимпиады</h3><p>Условная композиция общего компонента: задачи видны сразу; заголовок можно свернуть. Пример не создаёт семейных заданий.</p>
        <ProblemGroup id="demo-open-practice" title="Задачи для практики" problems={[{...writtenProblemDemo, id:'demo-practice-item', title:'Условная олимпиадная задача'}]} requiredProblems={[]} uploads={[]} reviews={[]} localPendingCount={0} sourceCount={0} ready defaultOpen><ProblemTaskCard problem={{...writtenProblemDemo, id:'demo-practice-item', title:'Условная олимпиадная задача'}} state={problemCardState([], undefined)} links={[]} parent={writtenParent} uploads={[]} helpAccess="ready" onPhotos={files=>addWrittenPhotos(files)} /></ProblemGroup>
        <p>Состояние фотографии, проверка работы и запрос помощи показаны отдельно. Олимпиадный серверный сценарий ещё не подключён.</p>
      </section>}
      {section==='olympiad-catalog' && <section aria-label="Пример семейного списка олимпиад"><h2>Семейный список олимпиад</h2><p>Условные данные: изменения не сохраняются и не отправляются.</p><div className="edu-kit-presets" aria-label="Роль в примере"><button type="button" aria-pressed={catalogParent} onClick={()=>setCatalogParent(true)}>Родитель</button><button type="button" aria-pressed={!catalogParent} onClick={()=>setCatalogParent(false)}>Ученик</button></div><OlympiadCatalog parent={catalogParent} items={[{id:'demo-formula',title:'Формула Единства / Третье тысячелетие · пример',subject:'Математика',deadline:'2026-11-05',participationEnabled:catalogSelection.includes('demo-formula'),practiceAvailable:true,lessons:[]},{id:'demo-energy',title:'Надежда энергетики · пример',subject:'Математика',schedule:'Тренировочный этап: 1 и 8 ноября',deadline:null,participationEnabled:catalogSelection.includes('demo-energy'),practiceAvailable:false,lessons:[]}]} onOpen={id=>setDemoTarget(id==='demo-formula'?'Формула Единства':'Надежда энергетики')} onParticipation={async (id,enabled)=>setCatalogSelection(current=>enabled?[...current,id]:current.filter(value=>value!==id))} />{demoTarget && <p role="status">Пример перехода: {demoTarget}</p>}</section>}
      {section==='olympiad-history' && <section id="olympiad-history-showcase"><h2>История участия · пример</h2><OlympiadHistoryShowcase /></section>}
      {section==='olympiad-page' && <section aria-label="Пример страницы олимпиады"><h2>Страница олимпиады</h2><p>Условный автономный пример семейной страницы. Источник данных здесь имитируется локально, сетевые запросы не выполняются.</p><div className="edu-kit-presets" aria-label="Роль в примере"><button type="button" aria-pressed={catalogParent} onClick={()=>setCatalogParent(true)}>Родитель</button><button type="button" aria-pressed={!catalogParent} onClick={()=>setCatalogParent(false)}>Ученик</button></div><OlympiadPage familyId="demo-family" childId="demo-child" olympiadId="demo" parent={catalogParent} dashboardToken="demo" watchSelections={demoOlympiadSelections} watchCatalog={demoOlympiadCatalog} watchHistoryIndex={(_f,_c,next)=>{next([]);return ()=>{}}} watchTasks={demoOlympiadTasks} watchDashboard={catalogParent ? demoOlympiadParentDashboard : demoOlympiadStudentDashboard} renderPractice={(task, _token, parent, quizTarget, number) => <>{task.testTokens.length > 0 && quizTarget && createPortal(<QuizCard chain={uiKitQuizExamples} parent={parent} linksEnabled={false} placementOptional reading={olympiadPracticeTheory['training-parity-v1']} />, quizTarget)}<ProblemCard problem={{...writtenProblemDemo,id:task.id,title:task.title,number}} state={problemCardState([], undefined)}><ProblemStatement problem={{...writtenProblemDemo,id:task.id,title:task.title,number,original:{text:"Условие задачи для примера.",attachmentRef:""}}} links={[]} parent={parent} originalContent={task.sourcePhotoIds?.length ? <p>Фрагмент исходного фото · пример</p> : undefined} /></ProblemCard></>} diagnosticsContext="demo" /><h3>Задача действующего тура</h3><ProblemCard problem={{...writtenProblemDemo,id:'demo-contest',title:'Задача действующего тура',number:1}} state={problemCardState([], undefined)}><p>Условие на фотографии; решение выполняется самостоятельно.</p>{!catalogParent && <PhotoUploadControl label="Загрузить решение" onPhotos={files=>addWrittenPhotos(files)} />}<p>Задание действующего тура. Решение выполняется самостоятельно; подсказки и автоматическая проверка недоступны до окончания тура.</p></ProblemCard><h3>Фрагмент фотографии условия</h3><p>Условный пример проверенного фрагмента сохранённого фото.</p><LinkedWorkPhotos taskId="demo-source-problem" uploads={[{ ...demoSharedPhoto, taskId:'demo-intake', storage:{ provider:'yandex-disk',state:'stored',path:'demo',size:1,sha256:'a'.repeat(64),syncedAt:null } }]} pages={[]} source={{ intakeTaskId:'demo-intake',uploadIds:['shared-photo'],crop:{x:10,y:20,width:360,height:100,sourceWidth:400,sourceHeight:240,sourceSha256:'a'.repeat(64)} }} number={1} role={catalogParent ? 'parent' : 'student'} diagnosticsContext="demo" /><h3>Очередь своего варианта</h3><p>Условные фотографии остаются в примере.</p><OlympiadSourceQueue parent={catalogParent} studentToken="demo" uploads={writtenUploads} localPhotos={[]} now={Date.now()} onPhotos={files=>addWrittenPhotos(files)} /></section>}
      {section==='olympiad-lesson' && <section aria-label="Пример игрового урока"><h2>Игровой урок</h2><p>Условный локальный пример общего компонента: никакие ответы не сохраняются и не отправляются. Настоящий урок получит только разрешённую сервером проекцию; его источники и проверка ещё не подключены.</p><OlympiadLesson diagnosticsContext="demo" view={lessonDemo} onAnswer={async id=>setLessonDemo(current=>({...current,feedback:id==='demo-a' ? {correct:true,text:'Фиксируем первую цифру и перебираем вторую: так каждый случай попадёт в список.'} : {correct:false,text:'Попробуй разбить все варианты на группы по первой цифре.'}}))} onAdvance={async ()=>setLessonDemo(current=>({...current,status:'completed',feedback:null}))}/></section>}
      {section==='olympiad-page' && <section aria-label="Олимпиада и архив"><h3>Пример источников олимпиады</h3><OlympiadReferences olympiadId="energy-hope-math-2026-2027" parent={catalogParent} context="demo" /></section>}
      {section==='guidance' && <section aria-label="Пример выбранной подсказки и полного раскрытия"><h2>Подсказка и полное раскрытие</h2><p>Демонстрационный этап «Прямая и направления». Родительский предпросмотр и ученическая запись используют один состав содержания. Источник показан короткой подписью; внутренний адрес и выдержка остаются закрытыми.</p><h3>Родитель</h3><ParentTaskGuide guide={guidanceDemo}/><h3>Ученик · полный шаг уже отправлен</h3><TaskGuidance items={[{ id: 'demo-release', taskId: 'demo-task', stageId: 'given', stageIndex: 0, level: 'reveal', text: guidanceDemo.stages[0].revealPreview!, revealContent: projectGuidanceReveal(guidanceDemo.stages[0]), guideRevision: 2, actorPersonId: 'demo-parent', createdAt: null }]} /></section>}
      {section==='homework' && <section aria-label="Пример сводки ДЗ"><h2>Сводка ДЗ</h2><p>Условные данные. Заголовок, дата и статусы используют тот же компонент, что и главная страница.</p><HomeworkOverview date="2026-10-19" rows={uiKitHomeworkRows} onOpen={row=>setDemoTarget(row.subject.name)} onOpenAll={()=>setDemoTarget('Все задания')}/>{demoTarget && <p role="status">Демонстрация перехода: {demoTarget}</p>}<p>Статус, задание и причина показаны отдельно. Длинный текст — короткий предпросмотр; полный разбор открывается нажатием на предмет.</p></section>}
      {section==='material' && <section aria-labelledby="kit-material-title"><h2 id="kit-material-title">Уточнение материала</h2><p>Пример с условными данными. Выбранные файлы остаются в этой демонстрации и не отправляются в Education.</p><MaterialRequest request={{id:'demo-notes',state:'open',question:'Какая последняя тема записана в тетради? Пришли фото записей с последнего урока.',photoPrompt:'Заголовок темы и все страницы последних записей целиком. Переписывать ничего не нужно.'}} label={demoFiles.length ? 'Материал выбран · пример' : 'Нужен материал для уточнения'} detail={demoFiles.length ? `Выбрано файлов: ${demoFiles.length}. На рабочей странице они будут переданы на Диск и попадут в следующий запуск синхронизации.` : 'Это вопрос для уточнения источника, а не требование учителя сдать письменную работу.'} /><PhotoUploadControl label="Добавить фото записей" onPhotos={files=>setDemoFiles(files.map(file=>file.name))}/><p>Фото помогает установить тему и увидеть записи. Само получение материала не отмечает домашнее задание выполненным.</p></section>}
      {section==='quiz' && <section aria-labelledby="kit-quiz-title"><h2 id="kit-quiz-title">История тестов</h2><p>Пример с условными данными. Тот же QuizCard используется на странице урока и в списке тестов. Нажмите название попытки для разбора, часы — для дат.</p><QuizCard chain={uiKitQuizExamples} parent={false} linksEnabled={false} context="Пример темы" assignment={<div className="edu-kit-assignment"><strong>Задание учителя · пример</strong><p>Повторить назначенную тему. Дополнительные упражнения не становятся обязательным домашним заданием.</p></div>} materials={<p>Демонстрационный материал. Персональных страниц и ответов здесь нет.</p>} />
      <h3>Что сохраняется при изменении дизайна</h3><ul><li>Корень цепочки, роли, обязательность и исходное задание учителя.</li><li>Верные ответы, баллы и вопросы считаются отдельно.</li><li>История идёт от новых завершений к старым. Поздний разбор не меняет порядок.</li><li>Просмотр дат и раскрытие ошибок не открывают новые подписки Firebase.</li></ul></section>}
      {section==='telegram' && <TelegramNotificationPreview />}
    </div></div>
  </div>
}
