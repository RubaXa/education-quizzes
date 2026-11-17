/** Full answer belongs to the authorized parent projection, never the child model.
 * @see ../../docs/modules/reviews/parent-review.md */
/** @see ../../docs/decisions/parent-review-pilot-2026-11-17.md */
import {ChevronDown} from 'lucide-react'
import SolutionBlocks,{MethodOverview} from './SolutionBlocks'
import type {ParentReviewState} from '../../packages/education-presentation/parent-review.mjs'
import './ParentReviewContent.css'
export default function ParentReviewContent({review}:{review:ParentReviewState}){
 if(review.state!=='ready')return <p role={review.state==='loading'?'status':'alert'}>{review.state==='loading'?'Загружаем родительский разбор…':review.state==='stale'?'Работа изменилась. Родительский разбор нужно сверить с новой попыткой.':'Не удалось загрузить родительский разбор. Повтори открытие карточки.'}</p>
 const a=review.analysis
 return <section className="edu-parent-review" aria-label="Полный разбор для родителя" data-decision-nodes="view.parent-review view.component" data-decision-edges="role:parent parent:component">
  <section className="edu-parent-review-answer"><h4>Как правильно</h4><p>{a.answer}</p></section>
  <section><h4>Что перепутано</h4><p>{a.difference}</p></section>
  <details className="edu-review-detail"><summary><span>Ход разбора</span><ChevronDown size={15} aria-hidden="true"/></summary><MethodOverview method={a.method}/><SolutionBlocks blocks={a.blocks}/><p className="edu-parent-review-source"><strong>Источник: </strong>{a.source.label} · {a.source.location}</p></details>
 </section>
}
