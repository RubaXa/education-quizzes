/** @see ../../docs/decisions/parent-review-pilot-2026-11-17.md */
/** @see ../../docs/decisions/quiz-review-dialogue-2026-11-17.md */
/** @see ../../docs/decisions/adaptive-review-modes-2026-11-17.md */
/** @see ../../docs/decisions/assignment-source-audit-corrections-2026-11-16.md */
/** @see ../../docs/decisions/program-explanation-2026-11-01.md */
/** @see ../../docs/decisions/compact-review-rollout-2026-10-31.md */
import {projectReviewSupplement} from '../../packages/education-presentation/review-content.mjs'
import { spellingFeedback } from '@/lib/spellingFeedback'
import type { Answer, QuizQuestion, QuestionResult } from '@/lib/quiz'
import { CodeBlock } from './CodeBlock'
import ReviewBrief, { type ReviewBriefData,type ReviewBriefDetail } from './ReviewBrief'
import './QuizResultCard.css'
import ParentReviewContent from './ParentReviewContent'
import type {ParentReviewState} from '../../packages/education-presentation/parent-review.mjs'
import ReviewConversation,{type ReviewConversationBinding} from './ReviewConversation'
import {quizQuestionReview} from '../../packages/education-presentation/quiz-review-reply.mjs'

function answerText(question: QuizQuestion, answer?: Answer): string {
  if (answer === undefined || answer === '' || (Array.isArray(answer) && !answer.length)) return 'Ответ не дан'
  if (Array.isArray(answer)) {
    return answer.map((id) => question.options?.find((option) => option.id === id)?.label ?? id).join(', ')
  }
  return question.options?.find((option) => option.id === answer)?.label ?? answer
}

/**
 * Показывает разбор отдельного вопроса после отправки теста.
 * @see ../../docs/modules/assessments/quizzes.md#quiz-results
 * @see ../../docs/shared/design/statuses.md#components
 */
export default function ResultCard({ result, index,parent=false,submittedAt,conversation,parentReview }: { result: QuestionResult; index: number;parent?:boolean;submittedAt?:unknown;conversation?:ReviewConversationBinding;parentReview?:ParentReviewState }) {
  const excluded = result.excluded === true
  const skipped = result.skipped === true || excluded
  const wrong = result.points === 0
  const pending = result.points === null && !skipped
  const partial = !pending && !wrong && !skipped && result.points !== result.question.points
  const needsReflection = wrong || partial
  const spelling = spellingFeedback(result)
  const guidance = result.guidance
  const written = result.question.kind === 'long' || result.question.kind === 'short'
  const answerFeedback = written && needsReflection && !skipped && typeof result.answer === 'string' && result.answer.trim()
    ? guidance?.answerFeedback
    : undefined
  const presentation=projectReviewSupplement(guidance?.presentation)
  const execution=Boolean(result.question.code && guidance?.mode==='program-explanation' && presentation?.visual?.kind==='comparison')
  const hasActiveQuestion=needsReflection&&!spelling&&!execution&&Boolean(guidance?.question)
  const details:ReviewBriefDetail[]=[]
  if(spelling) details.push({label:'Как пишется',text:`Правильно: ${spelling.correct}. ${spelling.detail}`},{label:'Что повторить',text:spelling.practice})
  if(guidance) details.push({label:'Источник вопроса',text:[guidance.source.title,guidance.source.edition,guidance.source.pages,...(parent||!hasActiveQuestion?[guidance.source.section,guidance.source.locator]:[])].filter(Boolean).join('. ')})
  else if(result.source) details.push({label:'Источник вопроса',text:result.source})
  const state=skipped?'skipped':pending?'waiting':wrong?'incorrect':partial?'revise':'verified'
  const stateLabel=excluded?'Не входит в зачёт этого задания':skipped?'Пропущено':pending?'Ждёт проверки':wrong?'Неверно':partial?'Частично верно':'Верно'
  const missing=needsReflection&&!spelling&&!guidance?'Для этого вопроса ещё нет проверенного разбора с точным источником.':undefined
  const data:ReviewBriefData = {id:result.question.id,label:`Вопрос ${index+1}`,status:state,stateLabel,
    prompt:result.question.prompt,response:{label:parent?'Ответ ребёнка':answerFeedback?'Ваш текстовый ответ':'Ваш ответ',value:answerText(result.question,result.answer)},
    answerFeedback,
    meta:skipped?'Без оценки':pending?`Баллы уточняются · максимум ${result.question.points}`:`${result.points} из ${result.question.points} баллов`,
    body:excluded?'Вопрос и собственный ответ сохранены в истории. Баллы не начисляются.':pending?'Разбор появится здесь после проверки.':skipped?'Вопрос не входил в оценку этой попытки.':undefined,
    focus:needsReflection&&!spelling&&guidance&&!answerFeedback?guidance.observation:missing,
    bridge:needsReflection&&execution?guidance?.reason:undefined,
    question:needsReflection&&!spelling&&!execution&&guidance?guidance.question:undefined,
    activity:needsReflection&&!execution?presentation?.activity:undefined,
    visual:needsReflection?presentation?.visual:undefined,details:[...(presentation?.details??[]),...details],
  }
  const sourceLink=guidance?.source.url&&<a className="edu-review-source-link" href={guidance.source.url} target="_blank" rel="noopener noreferrer">Открыть источник</a>
  const parentContent=parent&&parentReview?<ParentReviewContent review={parentReview}/>:undefined
  if((conversation||parentContent)&&data.activity&&data.question)return <ReviewConversation parent={parent} data={data} review={quizQuestionReview(result.question.id,submittedAt,guidance)} binding={conversation} parentContent={parentContent} context={result.question.code?<div className="edu-review-code"><CodeBlock code={result.question.code}/></div>:undefined}>{sourceLink}</ReviewConversation>
  if(parentContent)return <ReviewBrief readOnly context={result.question.code?<div className="edu-review-code"><CodeBlock code={result.question.code}/></div>:undefined} data={{...data,focus:undefined,bridge:undefined,question:undefined,activity:undefined,visual:undefined,details:[]}}>{parentContent}{sourceLink}</ReviewBrief>
  return <ReviewBrief readOnly={parent} context={result.question.code?<div className="edu-review-code"><CodeBlock code={result.question.code}/></div>:undefined} data={data}>
    {guidance?.source.url&&<a className="edu-review-source-link" href={guidance.source.url} target="_blank" rel="noopener noreferrer">Открыть источник</a>}
  </ReviewBrief>
}
