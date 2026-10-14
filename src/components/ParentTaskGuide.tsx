import { useEffect, useState } from 'react'
import { BookOpen, CheckCircle2, ChevronDown, CircleHelp, TriangleAlert } from 'lucide-react'
import type { DayWorkReview, ParentTaskGuide as Guide } from '@/lib/dayStore'
import { stageCompletion, stageRequired } from '@/lib/parentCompletion'
import type { ParentCompletionEvent } from '@/lib/parentCompletion'
import type { DayGuidance } from '@/lib/dayGuidance'
import { reportUiError } from '@/lib/uiErrors'
import RequirementSwitch from './RequirementSwitch'
import './ParentTaskGuide.css'

type Stage = Guide['stages'][number]
type Level = 'hint' | 'reveal'
const statusText = { correct: 'Верно в работе', incorrect: 'Расхождение', partial: 'Часть подтверждена', 'cannot-assess': 'Не удалось прочитать' }
function timeOf(value: unknown): number {
  if (typeof value === 'string') return Date.parse(value) || 0
  if (value && typeof value === 'object') {
    const stamp = value as { toMillis?: () => number; seconds?: number }
    return stamp.toMillis?.() ?? (stamp.seconds ?? 0) * 1000
  }
  return 0
}

/** Parent-only configurable stages below the existing task/ProblemStatement original.
 * @see ../../docs/product/card-generation-policy.md#math-adapter
 * @see ../../docs/product/card-generation-policy.md#russian-adapter
 * @see ../../docs/product/design-system.md#cards-and-status */
export default function ParentTaskGuide({ guide, review, decisions = [], guidance = [], guidanceReady = true, onSend, onStageChoice }: {
  guide: Guide; review?: DayWorkReview; decisions?: ParentCompletionEvent[]; guidance?: DayGuidance[]; guidanceReady?: boolean;
  onSend?: (stage: Stage, level: Level) => Promise<void>;
  onStageChoice?: (stage: Stage, required: boolean) => Promise<void>
}) {
  const [preview, setPreview] = useState<{ id: string; level: Level } | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<{ stageId: string; level: Level; text: string; at: number } | null>(null)
  const [stageSaving, setStageSaving] = useState('')
  const [pendingChoices, setPendingChoices] = useState<Record<string, { required: boolean; reviewVersion: number }>>({})
  const [stageError, setStageError] = useState<{ id: string; reviewVersion: number; message: string } | null>(null)
  const reviewVersion = (review?.checkedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0
  const unresolvedChoices = Object.fromEntries(Object.entries(pendingChoices).filter(([id, choice]) =>
    choice.reviewVersion === reviewVersion && stageRequired(review, id, decisions) !== choice.required))
  useEffect(() => {
    const unresolved = Object.entries(pendingChoices).filter(([id, choice]) =>
      choice.reviewVersion === reviewVersion && stageRequired(review, id, decisions) !== choice.required).map(([id]) => id)
    if (!unresolved.length) return
    const timeout = window.setTimeout(() => {
      const id = unresolved[0]
      setPendingChoices((current) => { const next = { ...current }; delete next[id]; return next })
      setStageError({ id, reviewVersion, message: 'Не удалось подтвердить изменение. Проверьте соединение и попробуйте ещё раз.' })
    }, 12000)
    return () => window.clearTimeout(timeout)
  }, [pendingChoices, decisions, review, reviewVersion])
  const reviewedItems = review?.items ?? []
  const observed = new Map(guide.stages.flatMap((stage) => {
    const linked = reviewedItems.filter((item) => item.stageId === stage.id || !item.stageId && stage.reviewLabels?.includes(item.label))
    if (!linked.length) return []
    const status = linked.some((item) => item.status === 'incorrect') ? 'incorrect'
      : linked.some((item) => item.status === 'partial') ? 'partial'
      : linked.some((item) => item.status === 'cannot-assess') ? 'cannot-assess' : 'correct'
    return [[stage.id, { status, observed: linked.map((item) => `${item.label}: ${item.observed ?? 'нет записи'}`).join(' · '), note: linked.map((item) => item.note).filter(Boolean).join(' · ') }] as const]
  }))
  const matched = guide.stages.filter((stage) => observed.has(stage.id))
  const correct = matched.filter((stage) => observed.get(stage.id)?.status === 'correct').length
  const completion = stageCompletion(review, decisions)
  const isRequired = (stage: Stage) => unresolvedChoices[stage.id]?.required ?? stageRequired(review, stage.id, decisions)
  const alreadySent = (stage: Stage) => {
    const previous = guidance.filter((item) => item.stageId === stage.id).map((item) => ({ level: item.level, text: item.text, at: timeOf(item.createdAt) }))
    if (sent?.stageId === stage.id) previous.push(sent)
    if (!previous.length) return false
    const latest = previous.reduce((a, b) => a.at >= b.at ? a : b)
    const currentText = latest.level === 'hint' ? stage.hintPreview : stage.revealPreview
    // A revised guide alone must not resend help; the next checked attempt must also offer new wording.
    return currentText === latest.text || timeOf(review?.checkedAt) <= latest.at
  }

  async function chooseStage(stage: Stage, required: boolean) {
    if (!onStageChoice || stageSaving || stage.id in unresolvedChoices) return
    setPendingChoices((current) => ({ ...current, [stage.id]: { required, reviewVersion } }))
    setStageSaving(stage.id); setStageError(null)
    try { await onStageChoice(stage, required) }
    catch (cause) {
      setPendingChoices((current) => { const next = { ...current }; delete next[stage.id]; return next })
      setStageError({ id: stage.id, reviewVersion, message: cause instanceof Error && /^(Пункт не связан|Не найдена текущая версия)/.test(cause.message)
        ? cause.message : reportUiError(cause, 'Решение родителя') })
    }
    finally { setStageSaving('') }
  }

  if (guide.presentation !== 'math-route' && guide.presentation !== 'learning-route') return <details className="day-parent-guide">
    <summary><BookOpen size={17} aria-hidden="true" /><span>Ориентир для проверки</span>
      {matched.length === guide.stages.length && <small>{correct} из {guide.stages.length} подтверждено по фото</small>}
      {matched.length > 0 && matched.length < guide.stages.length && <small>Сопоставлено {matched.length} из {guide.stages.length} этапов</small>}
    </summary>
    <div className="day-parent-guide-body"><p>{guide.overview}</p>
      {guide.boundary && <p className="day-parent-guide-boundary">{guide.boundary}</p>}
      <div className="day-parent-guide-stages">{guide.stages.map((stage) => {
        const result = observed.get(stage.id)
        return <details key={stage.id}><summary>{stage.title}{result && <span>{result.status === 'correct' ? '✓ Есть в работе' : result.status === 'incorrect' ? 'Нужно исправить' : result.status === 'partial' ? 'Часть есть' : 'Не удалось проверить'}</span>}</summary>
          <p>{stage.expected}</p>{stage.why && <p className="day-parent-guide-why">Почему: {stage.why}</p>}
          {result?.observed && <p className="day-parent-guide-observed">В работе ученика: {result.observed}</p>}
          <small>Источник: {stage.source.label}</small>
        </details>
      })}</div>
    </div>
  </details>

  const mathematics = guide.presentation === 'math-route'
  const firstAttention = guide.stages.findIndex((stage) => isRequired(stage) && ['incorrect', 'partial', 'cannot-assess'].includes(observed.get(stage.id)?.status ?? ''))
  const disputedCriterion = !mathematics && review?.assessmentBasis?.outcome === 'unresolved'
    && review?.workCoverage?.state === 'complete'
  async function send(stage: Stage, level: Level) {
    if (!onSend || !guidanceReady || sending || alreadySent(stage)) return
    setSending(true); setError('')
    try {
      await onSend(stage, level)
      setSent({ stageId: stage.id, level, text: (level === 'hint' ? stage.hintPreview : stage.revealPreview) ?? '', at: timeOf(review?.checkedAt) })
      setPreview(null)
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось отправить помощь.') }
    finally { setSending(false) }
  }

  return <details className="day-parent-guide day-parent-learning-route" aria-label={mathematics ? 'Разбор решения для родителя' : 'Разбор письменной работы для родителя'}>
    <summary className="day-learning-route-heading"><BookOpen size={18} aria-hidden="true" /><span><small>Разбор для родителя</small><strong>{mathematics ? 'От условия к ответу' : guide.overview}</strong></span><ChevronDown className="day-learning-route-chevron" size={17} aria-hidden="true" /></summary>
    <div className="day-parent-learning-route-body">
    {matched.length > 0 && <div className="day-learning-route-progress" aria-label="Состояние проверки фото">
      {mathematics && <><span>Ответ: <b>{review?.mathReasoning?.answer === 'correct' ? 'верен' : review?.mathReasoning?.answer === 'incorrect' ? 'неверен' : 'не подтверждён'}</b></span>
      <span>Ход: <b>{review?.mathReasoning?.argument === 'sufficient' ? 'подтверждён' : review?.mathReasoning?.argument === 'incomplete' ? 'неполон' : review?.mathReasoning?.argument === 'not-shown' ? 'не показан' : review?.mathReasoning?.argument === 'unreadable' ? 'не читается' : 'пока неясен'}</b></span></>}
      <small>{completion && !mathematics ? completion.complete
        ? `${completion.confirmed} из ${completion.required} пунктов подтверждено${completion.optional ? `; ${completion.optional} по желанию` : ''}. Работа выполнена по семейному плану.`
        : `${completion.confirmed} из ${completion.required} пунктов подтверждено${completion.optional ? `; ${completion.optional} по желанию` : ''}.`
        : disputedCriterion ? 'Все части задания предъявлены. Критерий формы спорен; от ребёнка пока ничего не требуется.'
        : firstAttention >= 0 ? `${correct} из ${matched.length} сопоставленных этапов подтверждено. Ниже — первое место, требующее внимания.`
          : `${correct} из ${matched.length} сопоставленных этапов подтверждено.`}</small>
    </div>}
    <div className="day-learning-route-stages">{guide.stages.map((stage, index) => {
      const result = observed.get(stage.id)
      const stageSent = alreadySent(stage)
      const active = !stageSent && preview?.id === stage.id ? preview : null
      const previewText = active?.level === 'hint' ? stage.hintPreview : stage.revealPreview
      const checkable = !mathematics && Boolean(review?.checkableStageIds?.includes(stage.id))
      const required = isRequired(stage)
      return <div className="day-learning-route-stage-shell" key={stage.id}><details className={`day-learning-route-stage ${result?.status ? `day-learning-route-${result.status}` : ''}${checkable && !required ? ' day-learning-route-optional' : ''}`} open={stageError?.id === stage.id && stageError.reviewVersion === reviewVersion}>
        <summary><span className="day-learning-route-number">{result?.status === 'correct' ? <CheckCircle2 size={17} aria-hidden="true" /> : result?.status === 'incorrect' ? <TriangleAlert size={17} aria-hidden="true" /> : result?.status === 'cannot-assess' ? <CircleHelp size={17} aria-hidden="true" /> : index + 1}</span><span className="day-learning-route-stage-title"><b>{stage.title}</b>{result && <small>{checkable && !required ? 'По желанию · не входит в итог' : disputedCriterion && result.status === 'cannot-assess' ? 'Критерий формы спорен' : !mathematics && result.status === 'cannot-assess' ? 'Пока не подтверждено' : statusText[result.status]}</small>}</span>
        </summary>
        <div className="day-learning-route-body">
          {stageError?.id === stage.id && stageError.reviewVersion === reviewVersion && <p className="day-learning-route-error" role="alert">{stageError.message}</p>}
          {result?.observed && <p className="day-learning-route-observed"><b>В работе:</b> {result.observed}{result.note && <small className="day-guide-review-note">{result.note}</small>}</p>}
          {stage.rows?.length ? <div className={`day-learning-route-rows day-learning-route-rows-${stage.role ?? 'plain'}`}>{stage.rows.map((row, rowIndex) => <div key={`${stage.id}-${rowIndex}`}><div>{row.label && <small>{row.label}</small>}<strong>{row.value}</strong></div>{row.explanation && <p>{row.explanation}</p>}</div>)}</div> : <p>{stage.expected}</p>}
          {stage.role === 'answer' && stage.answer && <div className="day-learning-route-answer"><small>Ответ</small><strong>{stage.answer}</strong></div>}
          {stage.role === 'answer' && !!stage.verification?.length && <details className="day-learning-route-check"><summary>Проверка по условию</summary>{stage.verification.map((row, rowIndex) => <p key={rowIndex}>{row.label && <b>{row.label}: </b>}{row.value}</p>)}</details>}
          {stage.why && <p className="day-learning-route-why">{stage.why}</p>}
          {guidanceReady && !stageSent && <div className="day-learning-route-actions">
            {stage.hintPreview && <button type="button" onClick={() => { setPreview({ id: stage.id, level: 'hint' }); setError('') }}>Отправить подсказку</button>}
            {stage.revealPreview && <button type="button" onClick={() => { setPreview({ id: stage.id, level: 'reveal' }); setError('') }}>{stage.role === 'answer' ? 'Показать ответ' : 'Показать этот шаг'}</button>}
          </div>}
          {guidanceReady && active && previewText && <div className="day-learning-route-preview"><b>{active.level === 'hint' ? 'Подсказка Пете' : 'Показать Пете'}</b><p>{previewText}</p><button type="button" disabled={sending || !onSend} onClick={() => void send(stage, active.level)}>{sending ? 'Отправляем…' : 'Отправить Пете'}</button>{!onSend && <small>Отправка пока недоступна.</small>}</div>}
          {stageSent && <p className="day-learning-route-sent" role="status">Помощь отправлена Пете.</p>}
          <small className="day-learning-route-source">Источник: {stage.source.label}</small>
        </div>
      </details>{checkable && <RequirementSwitch label={`Учитывать пункт «${stage.title}» при проверке`} checked={required} disabled={!onStageChoice || Boolean(stageSaving) || stage.id in unresolvedChoices} onChange={(checked) => void chooseStage(stage, checked)} />}</div>
    })}</div>
    {guide.boundary && <p className="day-parent-guide-boundary">{guide.boundary}</p>}
    {error && <p className="day-learning-route-error" role="alert">{error}</p>}
    </div>
  </details>
}
