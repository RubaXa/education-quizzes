import MaterialRequest from '@/components/MaterialRequest'
import PhotoUploadControl from '@/components/PhotoUploadControl'
import { useState } from 'react'
import { BookOpen, ChevronRight, CircleHelp, Layers3, Palette } from 'lucide-react'
import { ResultBadge, ResultMeter, ResultPoints } from '@/components/ui/result'
import QuizCard from '@/components/QuizCard'
import { uiKitQuizExamples } from '@/lib/uiKitExamples'
import type { ResultInput } from '@/lib/resultPresentation'
import tokenCss from './education-design-tokens.css?raw'
import './UiKit.css'

const topics = [
  {id:'tokens',group:'Основы',title:'Цвета и токены',icon:Palette},
  {id:'results',group:'Компоненты',title:'Индикаторы результата',icon:CircleHelp},
  {id:'material',group:'Составные сценарии',title:'Уточнение материала',icon:BookOpen},
  {id:'quiz',group:'Составные сценарии',title:'История тестов',icon:Layers3},
] as const
const colourRoles = [
  ['success','Зачтено','85–100% проверенных баллов'],['attention','Нужно повторить','50–менее 85%'],['error','Нужна тренировка','Менее 50%'],
  ['waiting','Ожидание','Результат ещё не проверен'],['accent','Выполнение','Заполняются ответы'],['neutral','Неизвестно','Данных для результата нет'],
] as const
const coreTokens: Record<string,string> = {
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
 * @see ../docs/product/ui-kit.md */
export default function UiKit() {
  const [section,setSection] = useState<(typeof topics)[number]['id']>('results')
  const [points,setPoints] = useState(34)
  const [max,setMax] = useState(39)
  const [state,setState] = useState('score')
  const [demoFiles,setDemoFiles] = useState<string[]>([])
  const input:ResultInput = state==='score' ? {kind:'score',points,maxPoints:max} : state==='answers' ? {kind:'answers',answered:points,total:max} : {kind:state==='waiting'?'waiting':'unknown'}
  return <div className="edu-kit">
    <header className="edu-kit-intro"><span><BookOpen size={18} aria-hidden="true" /> Education UI Kit</span><h1>Компоненты и правила</h1><p>Живые компоненты приложения, их состояния и смысл токенов. Начинаем с результатов; каталог расширяется постепенно.</p><a href="#/">На главную</a></header>
    <div className="edu-kit-layout"><nav aria-label="Разделы UI Kit">{topics.map(topic => <div key={topic.id}><small>{topic.group}</small><button type="button" aria-current={section===topic.id?'page':undefined} onClick={()=>setSection(topic.id)}><topic.icon size={16} aria-hidden="true" />{topic.title}<ChevronRight size={14} aria-hidden="true" /></button></div>)}</nav>
    <div className="edu-kit-content">
      {section==='results' && <section aria-labelledby="kit-results-title"><h2 id="kit-results-title">Индикаторы результата</h2><p>Метка, баллы и полоса используют одну политику цвета. Заполнение ответов и ожидание проверки — самостоятельные состояния.</p>
        <div className="edu-kit-playground"><div className="edu-kit-controls"><label>Состояние<select value={state} onChange={event=>setState(event.target.value)}><option value="score">Проверенный результат</option><option value="answers">Заполнение ответов</option><option value="waiting">Ожидание проверки</option><option value="unknown">Нет результата</option></select></label><label>{state==='answers'?'Ответов':'Баллов'}<input type="number" step="0.01" value={Number.isNaN(points)?'':points} disabled={state==='waiting'||state==='unknown'} onChange={event=>setPoints(event.target.valueAsNumber)} /></label><label>Всего<input type="number" min="1" step="0.01" value={Number.isNaN(max)?'':max} disabled={state==='waiting'||state==='unknown'} onChange={event=>setMax(event.target.valueAsNumber)} /></label></div>
        <div className="edu-kit-presets" aria-label="Примеры значений">{[0,50,84.99,85,100].map(value=><button type="button" key={value} onClick={()=>{setPoints(value);setMax(100);setState('score')}}>{value}%</button>)}</div>
        <div className="edu-kit-result-example" aria-live="polite"><ResultBadge input={input} showPoints /><div>{state==='score' && <ResultPoints points={points} maxPoints={max} />}</div><ResultMeter input={input} label={state==='answers'?'Доля заполненных ответов':'Процент набранных баллов'} /></div></div>
        <h3>Когда использовать</h3><ul><li><b>Метка результата:</b> процент в компактном списке или заголовке. Цвет дополняется числом и знаком.</li><li><b>Баллы:</b> набрано / максимум. Это не число полностью верных вопросов.</li><li><b>Полоса результата:</b> фактическая доля баллов; 0% остаётся пустой полосой с видимой меткой.</li><li><b>Заполнение:</b> пять ответов из пяти ещё не означают пять верных ответов. Поэтому полный черновик фиолетовый.</li><li><b>Ожидание:</b> без фиктивных 0% и без полосы результата.</li></ul>
        <h3>Границы</h3><p>Зачёт — от 85%. Янтарный — от 50% до порога зачёта. Красный — ниже 50%. Сравнение выполняется до округления: 84,99% не превращается в зелёные 85%. Эти границы относятся к тестам; школьный средний не переводится в проценты.</p>
      </section>}
      {section==='tokens' && <section aria-labelledby="kit-tokens-title"><h2 id="kit-tokens-title">Цвета и токены</h2><p>Базовое значение → смысловая роль → компонент. Компонент берёт цвет по смыслу, например success, а не выбирает свой зелёный.</p><div className="edu-kit-roles">{colourRoles.map(([role,label,description])=><div key={role} className={`edu-result-tone-${role}`}><span className="edu-kit-swatch" /><strong>{label}</strong><small>{description}</small><code>--edu-status-{role}-bg / ink</code></div>)}</div>
      <h3>Текущие CSS-токены</h3><p>Значения ниже получены из общего файла приложения. Изменение токена обновляет примеры и потребителей одновременно.</p><dl className="edu-kit-token-list">{tokenDefinitions.map(token=><div key={token.name}><dt><code>{token.name}</code><span className="edu-kit-token-preview" style={{background:token.name.endsWith('-bg')||token.name.endsWith('-ink')||token.name==='--edu-canvas'?`var(${token.name})`:undefined}} aria-hidden="true" /></dt><dd><code>{token.value}</code><p>{tokenMeaning(token.name)}</p></dd></div>)}</dl>
      </section>}
      {section==='material' && <section aria-labelledby="kit-material-title"><h2 id="kit-material-title">Уточнение материала</h2><p>Пример с условными данными. Выбранные файлы остаются в этой демонстрации и не отправляются в Education.</p><MaterialRequest request={{id:'demo-notes',state:'open',question:'Какая последняя тема записана в тетради? Пришли фото записей с последнего урока.',photoPrompt:'Заголовок темы и все страницы последних записей целиком. Переписывать ничего не нужно.'}} label={demoFiles.length ? 'Материал выбран · пример' : 'Нужен материал для уточнения'} detail={demoFiles.length ? `Выбрано файлов: ${demoFiles.length}. На рабочей странице они будут переданы на Диск и попадут в следующий запуск синхронизации.` : 'Это вопрос для уточнения источника, а не требование учителя сдать письменную работу.'} /><PhotoUploadControl label="Добавить фото записей" onPhotos={files=>setDemoFiles(files.map(file=>file.name))}/><p>Фото помогает установить тему и увидеть записи. Само получение материала не отмечает домашнее задание выполненным.</p></section>}
      {section==='quiz' && <section aria-labelledby="kit-quiz-title"><h2 id="kit-quiz-title">История тестов</h2><p>Пример с условными данными. Тот же QuizCard используется на странице урока и в списке тестов. Нажмите название попытки для разбора, часы — для дат.</p><QuizCard chain={uiKitQuizExamples} parent={false} linksEnabled={false} context="Пример темы" assignment={<div className="edu-kit-assignment"><strong>Задание учителя · пример</strong><p>Повторить назначенную тему. Дополнительные упражнения не становятся обязательным домашним заданием.</p></div>} materials={<p>Демонстрационный материал. Персональных страниц и ответов здесь нет.</p>} />
      <h3>Что сохраняется при изменении дизайна</h3><ul><li>Корень цепочки, роли, обязательность и исходное задание учителя.</li><li>Верные ответы, баллы и вопросы считаются отдельно.</li><li>История идёт от новых завершений к старым. Поздний разбор не меняет порядок.</li><li>Просмотр дат и раскрытие ошибок не открывают новые подписки Firebase.</li></ul></section>}
    </div></div>
  </div>
}
