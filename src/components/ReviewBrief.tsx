/** @see ../../docs/decisions/review-readability-repair-2026-10-31.md */
/** @see ../../docs/decisions/compact-review-rollout-2026-10-31.md */
/** @see ../../docs/shared/design/compact-review.md */
/** @see ../../docs/decisions/compact-review-ui-kit-2026-10-31.md */
import { ChevronDown } from 'lucide-react'
import StatusIcon from './StatusIcon'
import ReviewActivity from './ReviewActivity'
import type {ReviewReplyAction} from './ReviewReplyControls'
import type {ReviewActivityData} from '../../packages/education-presentation/review-activity.mjs'
import './ReviewBrief.css'
import './ReviewVisual.css'
import type { ReactNode } from 'react'
import type { ReviewVisualData,ReviewBriefDetail } from '../../packages/education-presentation/review-content.mjs'
import { reviewOverviewLimits } from '../../packages/education-presentation/review-content.mjs'
export type { ReviewVisualData,ReviewBriefDetail } from '../../packages/education-presentation/review-content.mjs'

/** Only an already authorized projection. No private guide, scoring or role resolution. */
export interface ReviewBriefData {
  id: string
  label: string
  status: 'revise' | 'verified' | 'uncertain' | 'incorrect' | 'waiting' | 'skipped' | 'neutral'
  stateLabel?: string
  prompt?: string
  response?: { label:string;value:string }
  body?: string
  meta?: string
  confirmed?: string
  focus?: string
  bridge?: string
  visual?: ReviewVisualData
  activity?: ReviewActivityData
  question?: string
  detail?: ReviewBriefDetail
  details?: ReviewBriefDetail[]
}

/** A representation of supplied facts: it neither solves nor sorts the material. */
export function ReviewVisual({ visual }: { visual: ReviewVisualData }) {
  if (visual.kind === 'comparison') return <figure className="edu-review-visual edu-review-comparison">
    <table aria-label={visual.label}><thead><tr>{visual.columns.map((column, index) => <th scope="col" key={index}>{column}</th>)}</tr></thead>
      <tbody>{visual.rows.map((row, index) => <tr key={index}>{visual.columns.map((_, column) => <td key={column}>{row.cells[column] ?? '—'}</td>)}</tr>)}</tbody></table>
  </figure>
  if (visual.kind === 'annotation') return <figure className="edu-review-visual edu-review-annotation" aria-label={visual.label}>
    <blockquote>{visual.parts.map((part, index) => part.mark
      ? <mark className={`edu-review-mark-${part.mark}`} key={index}>{part.text}</mark>
      : <span key={index}>{part.text}</span>)}</blockquote>
  </figure>
  if (visual.kind === 'timeline') return <figure className="edu-review-visual edu-review-timeline" aria-label={visual.label}>
    <ol>{visual.events.map((event, index) => <li key={`${event.date}-${index}`}>
      <span className="edu-review-date">{event.date}</span><span>{event.label}</span>
    </li>)}</ol>
  </figure>
  return <figure className="edu-review-visual edu-review-facts" aria-label={visual.label}>
    <dl>{visual.items.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    {visual.items.length > 1 && <svg className="edu-review-bracket" width="100%" height="12" aria-hidden="true">
      <line x1="8%" x2="92%" y1="3" y2="3" />
      <line x1="8%" x2="8%" y1="0" y2="3" /><line x1="92%" x2="92%" y1="0" y2="3" />
      <line x1="50%" x2="50%" y1="3" y2="11" />
    </svg>}
  </figure>
}

/** Shared presentation: policy and authorized data are supplied by the owning adapter. */
export default function ReviewBrief({ data,children,context,reply,articleRef }: { data: ReviewBriefData;children?:ReactNode;context?:ReactNode;reply?:Omit<ReviewReplyAction,'canAnswer'>;articleRef?:import('react').Ref<HTMLElement> }) {
  const complete = data.status === 'verified'
  const overflow:string[]=[]
  const readable=(value:string|undefined,limit:number)=>{
    if(value&&value.trim().length>limit){overflow.push(value);return undefined}
    return value
  }
  const body=readable(data.body,reviewOverviewLimits.focus)
  const focus=!complete?readable(data.focus,reviewOverviewLimits.focus):undefined
  const bridge=!complete?readable(data.bridge,reviewOverviewLimits.bridge):undefined
  const details = [...(overflow.length?[{label:'Подробное пояснение',text:overflow.join('\n\n')}]:[]),...(data.details ?? (data.detail ? [data.detail] : []))]
  return <article ref={articleRef} className="edu-review-brief" aria-label={data.label} data-review-state={data.status}>
    <header className="edu-review-header"><h3 className="edu-review-title">{data.label}</h3>
      <span className="edu-review-state">{data.stateLabel??({verified:'Зачтено',uncertain:'Уточняем',revise:'Есть правка',incorrect:'Нужна правка',waiting:'Ждёт проверки',skipped:'Без оценки',neutral:'Ориентир'}[data.status])}</span></header>
    {data.meta&&<p className="edu-review-copy edu-review-meta">{data.meta}</p>}
    {data.prompt&&<p className="edu-review-copy edu-review-prompt">{data.prompt}</p>}
    {context}
    {data.response&&<p className="edu-review-copy edu-review-response"><span>{data.response.label}</span><strong>{data.response.value}</strong></p>}
    {body&&<p className="edu-review-copy">{body}</p>}
    {data.confirmed && <p className="edu-review-copy edu-review-confirmed"><StatusIcon status="complete" size={15} /><span>{data.confirmed}</span></p>}
    {!complete && <>
      {focus && <p className="edu-review-copy edu-review-focus">{focus}</p>}
      {data.visual && !data.activity && <ReviewVisual visual={data.visual} />}
      {bridge && <p className="edu-review-copy edu-review-bridge">{bridge}</p>}
      {data.question && <p tabIndex={-1} className="edu-review-copy edu-review-question">{data.question}</p>}
      {data.activity && <ReviewActivity key={data.id} activity={data.activity} reply={reply}/>}
    </>}
    {details.map((detail, index) => <details className="edu-review-detail" key={`${data.id}-${index}`}>
      <summary><span>{detail.label}</span><ChevronDown size={15} aria-hidden="true" /></summary>
      {detail.quotation && <blockquote className="edu-review-quotation">{detail.quotation}</blockquote>}
      {detail.visual && <ReviewVisual visual={detail.visual} />}
      <p className="edu-review-copy">{detail.text}</p>
    </details>)}
    {children}
  </article>
}
