/** @see ../../docs/decisions/review-readability-repair-2026-10-31.md */
/** @see ../../docs/decisions/compact-review-rollout-2026-10-31.md */
/** @see ../../docs/shared/design/compact-review.md#showcase */
/** @see ../../docs/decisions/compact-review-ui-kit-2026-10-31.md */
import { useState } from 'react'
import WorkReview from './WorkReview'
import QuizResultCard from './QuizResultCard'
import ParentTaskGuide from './ParentTaskGuide'
import {solutionGuideExample,solutionVisualExamples} from '@/lib/solutionExamples'
import SolutionBlocks from './SolutionBlocks'
import { reviewBriefExamples, reviewBriefUncertain, reviewBriefVerified,reviewBriefWorkExample,reviewBriefLegacy } from '@/lib/reviewBriefExamples'

export default function ReviewBriefShowcase() {
  const [example, setExample] = useState(0)
  const [state, setState] = useState<'revise' | 'verified' | 'uncertain'|'legacy'>('revise')
  const [parent,setParent]=useState(false)
  const data = state === 'verified' ? reviewBriefVerified : state === 'uncertain' ? reviewBriefUncertain : reviewBriefExamples[example].data
  const review=state==='legacy'?reviewBriefLegacy:reviewBriefWorkExample(data)
  return <section aria-label="Компактный разбор">
    <h2>Компактный разбор</h2>
    <p>Условные данные. Те же компоненты показывают разбор на странице дня, в практике и после теста.</p>
    <div className="edu-kit-presets" aria-label="Предмет в примере">{reviewBriefExamples.map((item, index) => <button type="button" key={item.name} aria-pressed={example === index} onClick={() => { setExample(index); setState('revise') }}>{item.name}</button>)}</div>
    <div className="edu-kit-presets" aria-label="Состояние разбора">{([['revise', 'Есть правка'], ['verified', 'Зачтено'], ['uncertain', 'Неясно'],['legacy','Старая подробная запись']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={state === value} onClick={() => setState(value)}>{label}</button>)}</div>
    <div className="edu-kit-presets" aria-label="Роль в примере"><button type="button" aria-pressed={!parent} onClick={()=>setParent(false)}>Ученик</button><button type="button" aria-pressed={parent} onClick={()=>setParent(true)}>Родитель</button></div>
    <div style={{ maxWidth: 390 }}><WorkReview parent={parent} review={review} uploads={[]} /></div>
    <p>Один компонент: строка результата, точка внимания, предметная опора и один вопрос. Дополнительное пояснение открывается на месте.</p>
    <h3>Полный путь: метод и случаи</h3><p>Условные данные. Тот же родительский компонент, формулы и выбор случая; действий с семейными данными нет.</p><div style={{maxWidth:390}}><ParentTaskGuide guide={solutionGuideExample}/></div>
    <details style={{maxWidth:390}}><summary>Другие модели: сетка и граф</summary><SolutionBlocks blocks={solutionVisualExamples}/></details>
    <h3>Разбор вопроса теста</h3><div style={{maxWidth:390}}><QuizResultCard index={0} result={{question:{id:'demo-question',kind:'short',prompt:'Назови единицу измерения длины.',points:1},answer:'минуты',points:0,guidance:{observation:'В ответе названа единица времени.',question:'Какую величину нужно измерить по условию?',source:{title:'Условный учебный источник',edition:'Пример UI Kit',section:'Величины',pages:'Условная страница',locator:'Таблица единиц'}}}} /></div>
  </section>
}
