/** @see ../../docs/decisions/compact-review-rollout-2026-10-31.md */
import { spellingFeedback } from '@/lib/spellingFeedback'
import type { Answer, QuizQuestion, QuestionResult } from '@/lib/quiz'
import { CodeBlock } from './CodeBlock'
import ReviewBrief, { type ReviewBriefDetail } from './ReviewBrief'
import './QuizResultCard.css'

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
export default function ResultCard({ result, index }: { result: QuestionResult; index: number }) {
  const skipped = result.skipped === true
  const wrong = result.points === 0
  const pending = result.points === null && !skipped
  const partial = !pending && !wrong && !skipped && result.points !== result.question.points
  const needsReflection = wrong || partial
  const spelling = spellingFeedback(result)
  const guidance = result.guidance
  const details:ReviewBriefDetail[]=[]
  if(spelling) details.push({label:'Как пишется',text:`Правильно: ${spelling.correct}. ${spelling.detail}`},{label:'Что повторить',text:spelling.practice})
  if(guidance) details.push({label:'Источник вопроса',text:[guidance.source.title,guidance.source.edition,guidance.source.section,guidance.source.pages,guidance.source.locator].join('. ')})
  else if(result.source) details.push({label:'Источник вопроса',text:result.source})
  const state=skipped?'skipped':pending?'waiting':wrong?'incorrect':partial?'revise':'verified'
  const stateLabel=skipped?'Пропущено':pending?'Ждёт проверки':wrong?'Неверно':partial?'Частично верно':'Верно'
  const missing=needsReflection&&!spelling&&!guidance?'Для этого вопроса ещё нет проверенного разбора с точным источником.':undefined
  return <ReviewBrief context={result.question.code?<div className="edu-review-code"><CodeBlock code={result.question.code}/></div>:undefined} data={{id:result.question.id,label:`Вопрос ${index+1}`,status:state,stateLabel,
    prompt:result.question.prompt,response:{label:'Ваш ответ',value:answerText(result.question,result.answer)},
    meta:skipped?'Без оценки':pending?`Баллы уточняются · максимум ${result.question.points}`:`${result.points} из ${result.question.points} баллов`,
    body:pending?'Разбор появится здесь после проверки.':skipped?'Вопрос не входил в оценку этой попытки.':undefined,
    focus:needsReflection&&!spelling&&guidance?guidance.observation:missing,
    question:needsReflection&&!spelling&&guidance?guidance.question:undefined,
    details,
  }}>
    {guidance?.source.url&&<a className="edu-review-source-link" href={guidance.source.url} target="_blank" rel="noopener noreferrer">Открыть источник</a>}
  </ReviewBrief>
}
