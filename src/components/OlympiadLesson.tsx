import { useEffect, useState } from 'react'
import { traceLesson } from '@/lib/browserAccessTrace'
import { Button } from '@/components/ui/button'
import './OlympiadLesson.css'

/** Client receives only an authorized student projection, never a private lesson definition.
 * @see ../../docs/modules/assessments/olympiad-preparation.md#модель-урока-и-свидетельств
 * @see ../../docs/decisions/olympiad-domain-ldd-2026-10-27.md */
export type OlympiadLessonProjection = {
  title: string
  status: 'active' | 'completed'
  theory?: string
  currentStep: number
  stepCount: number
  step?: { id: string; prompt: string; options: { id: string; text: string }[] }
  feedback?: { correct: boolean; text: string } | null
}
export default function OlympiadLesson({ view, onAnswer, onAdvance, diagnosticsContext }: {
  view: OlympiadLessonProjection
  diagnosticsContext?: 'demo' | 'product'
  onAnswer: (optionId: string) => Promise<void>
  onAdvance: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => { if (diagnosticsContext) traceLesson('opened', diagnosticsContext, 'student') }, [diagnosticsContext])
  useEffect(() => { if (diagnosticsContext && view.feedback) traceLesson('answer-shown', diagnosticsContext, 'student', {count:view.currentStep}) }, [diagnosticsContext, view.feedback, view.currentStep])
  useEffect(() => { if (diagnosticsContext && view.status === 'completed') traceLesson('completed', diagnosticsContext, 'student', {count:view.stepCount}) }, [diagnosticsContext, view.status, view.stepCount])
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true);setError(false)
    if (diagnosticsContext) traceLesson('waiting', diagnosticsContext, 'student')
    try { await action() } catch { setError(true);if (diagnosticsContext) traceLesson('failed', diagnosticsContext, 'student', {code:'submit-failed'}) } finally { setBusy(false) }
  }
  return <section className="olympiad-lesson" aria-label={view.title}>
    <h3>{view.title}</h3>
    {view.theory && <details open><summary>Знакомство с приёмом</summary><p>{view.theory}</p></details>}
    {view.status === 'completed' ? <p role="status">Урок завершён. Можно вернуться к другим темам.</p>
      : view.step ? <>
        <p className="olympiad-lesson-progress">Шаг {view.currentStep} из {view.stepCount}</p>
        <p className="olympiad-lesson-prompt">{view.step.prompt}</p>
        <div className="olympiad-lesson-options" role="group" aria-label="Выбери ответ">{view.step.options.map(option =>
          <Button key={option.id} variant="outline" disabled={busy || Boolean(view.feedback?.correct)} onClick={() => { if (diagnosticsContext) traceLesson('choice-selected', diagnosticsContext, 'student', {count:view.currentStep}); void run(() => onAnswer(option.id)) }}>{option.text}</Button>)}</div>
        {view.feedback && <div className="olympiad-lesson-feedback" role="status"><strong>{view.feedback.correct ? 'Верно' : 'Попробуй ещё раз'}</strong><p>{view.feedback.text}</p></div>}
        {view.feedback?.correct && <Button disabled={busy} onClick={() => { if (diagnosticsContext) traceLesson('next-step', diagnosticsContext, 'student', {count:view.currentStep}); void run(onAdvance) }}>{view.currentStep === view.stepCount ? 'Завершить урок' : 'Следующий шаг'}</Button>}
      </> : <p role="status">Шаг урока недоступен. Попробуй открыть урок позже.</p>}
    {error && <p role="alert">Не удалось сохранить действие. Попробуй ещё раз.</p>}
  </section>
}
