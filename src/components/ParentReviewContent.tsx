/** @see ../../docs/decisions/parent-review-pilot-2026-11-17.md */
/** Parent-only data adapter; the approved route is owned by ParentTaskGuide.
 * @see ../../docs/modules/reviews/parent-review.md#graph
 * @see ../../docs/decisions/restore-parent-route-2026-11-17.md */
import ParentTaskGuide from './ParentTaskGuide'
import type {ParentTaskGuide as Guide} from '@/lib/dayStore'
import type {ParentReviewState} from '../../packages/education-presentation/parent-review.mjs'
export default function ParentReviewContent({review}:{review:ParentReviewState}){
 if(review.state!=='ready')return <p role={review.state==='loading'?'status':'alert'}>{review.state==='loading'?'Загружаем родительский разбор…':review.state==='stale'?'Работа изменилась. Родительский разбор нужно сверить с новой попыткой.':'Не удалось загрузить родительский разбор. Повтори открытие карточки.'}</p>
 const a=review.analysis
 const guide:Guide={kind:'worked-solution',presentation:'learning-route',method:a.method,overview:a.method.reason,
  stages:a.blocks.map((block,index)=>({id:`analysis-${index+1}`,title:block.kind==='text'?block.title??'Объяснение':block.kind==='visual'?block.visual.label:'label' in block?block.label:'Переход',role:'solution',expected:'',blocks:[block.kind==='text'?{...block,title:undefined}:block],
   // The source is the verified family publication; its original locator stays intact.
   source:{kind:'family',label:`${a.source.label} · ${a.source.location}`,ref:'quiz-parent-review:source',excerpt:''}}))}
 return <section className="edu-parent-review" aria-label="Полный разбор для родителя" data-decision-nodes="view.parent-review view.component" data-decision-edges="role:parent parent:component">
  <p><strong>Правильный ответ: </strong>{a.answer}</p>
  <p><strong>Что перепутано: </strong>{a.difference}</p>
  <ParentTaskGuide guide={guide}/>
 </section>
}
