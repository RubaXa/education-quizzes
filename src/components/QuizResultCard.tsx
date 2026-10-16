import { BookOpen } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ResultPoints } from '@/components/ui/result'
import { spellingFeedback } from '@/lib/spellingFeedback'
import type { Answer, QuizQuestion, QuestionResult } from '@/lib/quiz'
import { CodeBlock } from './CodeBlock'
import StatusIcon from './StatusIcon'

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
  const reflectionQuestion = result.question.kind === 'single' || result.question.kind === 'multiple' || result.question.kind === 'figure'
    ? 'Какой факт из задания подтверждает твой выбор? Найди его в назначенном материале и сравни со своим ответом.'
    : 'На каком шаге твоя запись перестаёт следовать условию? Сверь этот шаг с назначенным материалом.'
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge className={`edu-quiz-result-status ${skipped ? 'unknown' : pending ? 'waiting' : wrong ? 'incorrect' : partial ? 'partial' : 'complete'}`} variant={skipped || pending || partial ? 'secondary' : wrong ? 'destructive' : 'default'}>
            <StatusIcon size={14} status={skipped ? 'unknown' : pending ? 'waiting' : wrong ? 'incorrect' : partial ? 'partial' : 'complete'} />
            {skipped ? 'Пропущено' : pending ? 'Ждёт проверки' : wrong ? 'Неверно' : partial ? 'Частично верно' : 'Верно'}
          </Badge>
          <span className="text-sm">{skipped ? 'Без оценки' : <ResultPoints points={pending ? undefined : result.points ?? undefined} maxPoints={result.question.points} />}</span>
        </div>
        <CardTitle className="text-lg leading-snug">{index + 1}. {result.question.prompt}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm sm:text-base">
        {result.question.code && <CodeBlock code={result.question.code} />}
        <div className="result-answers">
          <p className={wrong ? 'result-answer-wrong' : ''}><span>Ваш ответ</span><strong>{answerText(result.question, result.answer)}</strong></p>
        </div>
        {pending && <p className="text-muted-foreground">Разбор появится здесь после проверки.</p>}
        {skipped && <p className="text-muted-foreground">Вопрос не входил в оценку этой попытки.</p>}
        {spelling ? (
          <section className="result-learning" aria-label="Разбор написания слова">
            <div className="result-rule">
              <h3>Как пишется</h3>
              <p>Правильно: <strong>{spelling.correct}</strong></p>
              <p>{spelling.detail}</p>
            </div>
            <div className="result-material">
              <BookOpen className="size-5 shrink-0" aria-hidden="true" />
              <div>
                <h3>Что повторить</h3>
                <p>{spelling.practice}</p>
                {result.source && <p>В учебнике: {result.source}</p>}
              </div>
            </div>
          </section>
        ) : needsReflection && (
          <section className="result-learning" aria-label="Ориентир для самостоятельной проверки">
            <div className="result-rule">
              <h3>Проверь свой ход</h3>
              <p>{reflectionQuestion}</p>
            </div>
            <div className="result-material">
              <BookOpen className="size-5 shrink-0" aria-hidden="true" />
              <div>
                <h3>Где искать</h3>
                <p>Вернись к материалу, указанному в карточке теста. Он поможет проверить именно этот вопрос.</p>
              </div>
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  )
}
