/** @see ../../docs/decisions/quiz-runner-kit-audit-2026-11-01.md */
/** @see ../../docs/modules/assessments/quizzes.md */
import type {Answer,QuizQuestion,QuizVisual} from '@/lib/quiz'
import {wordForm} from '@/lib/wordForm'
import {Badge} from './ui/badge'
import {Card,CardHeader,CardTitle,CardDescription,CardContent} from './ui/card'
import {Checkbox} from './ui/checkbox'
import {RadioGroup,RadioGroupItem} from './ui/radio-group'
import {CodeBlock} from './CodeBlock'
import {QuizTextAnswer} from './QuizTextAnswer'
import EducationImage from './EducationImage'

export default function QuestionCard({
  question,
  index,
  answer,
  onAnswer,
  subject,
  visual,
  disabled = false,
  showTopic = true,
}: {
  question: QuizQuestion
  index: number
  answer?: Answer
  onAnswer: (value: Answer) => void
  subject: string
  visual?: QuizVisual
  disabled?: boolean
  showTopic?: boolean
}) {
  const optionList = question.options ?? []
  const asString = typeof answer === 'string' ? answer : ''
  const asArray = Array.isArray(answer) ? answer : []

  return (
    <Card className="question-card border-0 shadow-sm">
      <CardHeader className="gap-3">
        <div className="quiz-question-topline flex flex-wrap items-center justify-between gap-2">
          <Badge variant="secondary">Вопрос {index + 1}</Badge>
          <span className="text-sm text-muted-foreground">{question.points} {wordForm(question.points, 'балл', 'балла', 'баллов')}</span>
        </div>
        <CardTitle className="text-xl leading-snug sm:text-2xl">{question.prompt}</CardTitle>
        {showTopic && question.topic && <CardDescription>Тема: {question.topic}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        {question.code && <CodeBlock code={question.code} />}
        {question.imageUrl && <EducationImage className="question-image" source={question.imageUrl} alt={question.imageAlt ?? 'Иллюстрация к вопросу'} aspectRatio="16 / 9" />}
        {(question.kind === 'single' || question.kind === 'figure') && (
          <RadioGroup value={asString} onValueChange={onAnswer} disabled={disabled} className="gap-3">
            {optionList.map((option) => (
              <label key={option.id} className="option-tile">
                <RadioGroupItem value={option.id} aria-label={option.label} />
                <span className="min-w-0 flex-1">
                  {option.imageUrl && <EducationImage className="option-image" source={option.imageUrl} alt={option.imageAlt ?? option.label} aspectRatio="4 / 3" />}
                  <span>{option.label}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        )}
        {question.kind === 'multiple' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Можно выбрать несколько вариантов.</p>
            {optionList.map((option) => (
              <label key={option.id} className="option-tile">
                <Checkbox
                  checked={asArray.includes(option.id)}
                  disabled={disabled}
                  onCheckedChange={(checked) => onAnswer(checked ? [...asArray, option.id] : asArray.filter((item) => item !== option.id))}
                />
                <span className="min-w-0 flex-1">{option.label}</span>
              </label>
            ))}
          </div>
        )}
        {(question.kind === 'short' || question.kind === 'number' || question.kind === 'long') && (
          <QuizTextAnswer kind={question.kind} value={asString} disabled={disabled} subject={subject} visual={visual} onAnswer={onAnswer} />
        )}
      </CardContent>
    </Card>
  )
}
