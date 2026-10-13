import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { QuizVisual } from '@/lib/quiz'
import { resolveVisual } from '@/lib/visual'

/**
 * Text answer fields shared by short, numeric and long quiz questions.
 * @see ../../docs/product/quizzes.md#quiz-runner
 */
export function QuizTextAnswer({ kind, value, disabled, subject, visual, onAnswer }: {
  kind: 'short' | 'number' | 'long'
  value: string
  disabled: boolean
  subject: string
  visual?: QuizVisual
  onAnswer: (value: string) => void
}) {
  const noWritingAssistance = resolveVisual(subject).preset === 'english' || visual?.preset === 'english'
  const writingAttributes = noWritingAssistance ? {
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'off',
    spellCheck: false,
  } : {}
  if (kind === 'long') return (
    <Textarea
      {...writingAttributes}
      value={value}
      disabled={disabled}
      placeholder="Опишите решение или объясните ответ своими словами"
      onChange={(event) => onAnswer(event.target.value)}
      className="min-h-36 text-base"
    />
  )
  return (
    <Input
      {...writingAttributes}
      value={value}
      disabled={disabled}
      inputMode={kind === 'number' ? 'decimal' : 'text'}
      placeholder={kind === 'number' ? 'Введите число' : 'Напишите ответ'}
      onChange={(event) => onAnswer(event.target.value)}
      className="h-12 text-base"
    />
  )
}
