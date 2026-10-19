import { useEffect, useState } from 'react'
import { BookOpen, ChevronDown } from 'lucide-react'
import type { DayWorkReview, ParentTaskGuide as Guide } from '@/lib/dayStore'
import { stageCompletion, stageRequired } from '@/lib/parentCompletion'
import type { ParentCompletionEvent } from '@/lib/parentCompletion'
import type { DayGuidance } from '@/lib/dayGuidance'
import { reportUiError } from '@/lib/uiErrors'
import { formatReviewObservation, formatReviewProse } from '@/lib/reviewProse'
import GuidanceStageContent from './GuidanceStageContent'
import { projectGuidanceReveal, sameGuidanceRevealContent } from '../../day/guidance-release.mjs'
import RequirementSwitch from './RequirementSwitch'
import StatusIcon from './StatusIcon'
import './ParentTaskGuide.css'

/** @see ../../docs/modules/reviews/subject-aware-guidance.md */
/** @see ../../docs/decisions/released-stage-parity-2026-10-20.md */
/** @see ../../docs/shared/design/ui-kit.md#помощь-по-этапам */

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
 * @see ../../docs/modules/reviews/card-generation-policy.md#math-adapter
 * @see ../../docs/modules/reviews/card-generation-policy.md#russian-adapter
 * @see ../../docs/modules/reviews/problem-card-design-decisions.md#role-projection
 * @see ../../docs/modules/reviews/problem-card-design-decisions.md#flat-numbered-sheet
 * @see ../../docs/decisions/math-parent-stage-review-2026-10-19.md
 * @see ../../docs/decisions/guidance-hint-then-reveal-2026-10-19.md
 * @see ../../docs/modules/school-diary/day-page.md#review-stage-switch
 * @see ../../docs/shared/design/statuses.md#components */
export default function ParentTaskGuide({ guide, review, decisions = [], guidance = [], guidanceReady = true, onSend, onStageChoice }: {
  guide: Guide; review?: DayWorkReview; decisions?: ParentCompletionEvent[]; guidance?: DayGuidance[]; guidanceReady?: boolean;
  onSend?: (stage: Stage, level: Level) => Promise<void>;
  onStageChoice?: (stage: Stage, required: boolean) => Promise<void>
}) {
  const [preview, setPreview] = useState<{ id: string; level: Level } | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<{ stageId: string; level: Level; text: string; revealContent?: DayGuidance['revealContent']; at: number }[]>([])
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
  const alreadySent = (stage: Stage, level: Level) => {
    const previous: { text: string; revealContent?: DayGuidance['revealContent']; at: number }[] = guidance.filter((item) => item.stageId === stage.id && item.level === level)
      .map((item) => ({ text: item.text, revealContent: item.revealContent, at: timeOf(item.createdAt) }))
    previous.push(...sent.filter((item) => item.stageId === stage.id && item.level === level))
    if (!previous.length) return false
    const latest = previous.reduce((a, b) => a.at >= b.at ? a : b)
    const currentText = level === 'hint' ? stage.hintPreview : stage.revealPreview
    const currentReveal = level === 'reveal' ? projectGuidanceReveal(stage) : undefined
    const sameRelease = currentText === latest.text && (level === 'hint' || !latest.revealContent
      || sameGuidanceRevealContent(currentReveal, latest.revealContent))
    // A revised guide alone must not resend help; the next checked attempt must also offer new wording.
    return sameRelease || timeOf(review?.checkedAt) <= latest.at
  }

  async function chooseStage(stage: Stage, required: boolean) {
    if (!onStageChoice || stageSaving || stage.id in unresolvedChoices) return
    setPendingChoices((current) => ({ ...current, [stage.id]: { required, reviewVersion } }))
    setStageSaving(stage.id); setStageError(null)
    try { await onStageChoice(stage, required) }
    catch (cause) {
      setPendingChoices((current) => { const next = { ...current }; delete next[stage.id]; return next })
      setStageError({ id: stage.id, reviewVersion, message: cause instanceof Error && /^(Пункт не связан|Не найдена текущая версия|Разбор изменился|Выбор не сохранён)/.test(cause.message)
        ? cause.message : reportUiError(cause, 'Решение родителя') })
    }
    finally { setStageSaving('') }
  }

  if (guide.presentation !== 'math-route' && guide.presentation !== 'learning-route') return <details className="day-parent-guide">
    <summary><BookOpen size={17} aria-hidden="true" /><span>Ориентир для проверки</span>
      {matched.length === guide.stages.length && <small>{correct} из {guide.stages.length} подтверждено по фото</small>}
      {matched.length > 0 && matched.length < guide.stages.length && <small>Сопоставлено {matched.length} из {guide.stages.length} этапов</small>}
    </summary>
    <div className="day-parent-guide-body"><p>{formatReviewProse(guide.overview)}</p>
      {guide.boundary && <p className="day-parent-guide-boundary">{formatReviewProse(guide.boundary)}</p>}
      <div className="day-parent-guide-stages">{guide.stages.map((stage) => {
        const result = observed.get(stage.id)
        return <details key={stage.id}><summary>{formatReviewProse(stage.title)}{result && <span><StatusIcon size={14} status={result.status === 'correct' ? 'complete' : result.status === 'incorrect' ? 'needs-fix' : result.status === 'partial' ? 'partial' : 'unknown'} />{result.status === 'correct' ? 'Есть в работе' : result.status === 'incorrect' ? 'Нужно исправить' : result.status === 'partial' ? 'Часть есть' : 'Не удалось проверить'}</span>}</summary>
          <p>{formatReviewProse(stage.expected)}</p>{stage.why && <p className="day-parent-guide-why">Почему: {formatReviewProse(stage.why)}</p>}
          {result?.observed && <p className="day-parent-guide-observed">В работе ученика: {formatReviewObservation(result.observed)}</p>}
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
    if (!onSend || !guidanceReady || sending || alreadySent(stage, level)) return
    setSending(true); setError('')
    try {
      await onSend(stage, level)
      setSent((current) => [...current.filter((item) => item.stageId !== stage.id || item.level !== level), {
        stageId: stage.id, level, text: (level === 'hint' ? stage.hintPreview : stage.revealPreview) ?? '',
        revealContent: level === 'reveal' ? projectGuidanceReveal(stage) : undefined, at: timeOf(review?.checkedAt),
      }])
      setPreview(null)
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось отправить помощь.') }
    finally { setSending(false) }
  }

  return <details className="day-parent-guide day-parent-learning-route" aria-label={mathematics ? 'Разбор решения для родителя' : 'Разбор письменной работы для родителя'}>
    <summary className="day-learning-route-heading"><BookOpen size={18} aria-hidden="true" /><span><strong>{mathematics ? 'Разбор для родителя' : formatReviewProse(guide.overview)}</strong></span><ChevronDown className="day-learning-route-chevron" size={17} aria-hidden="true" /></summary>
    <div className="day-parent-learning-route-body">
    {!mathematics && review?.status && <div className="day-learning-route-review-summary">
      <strong>{review.status === 'verified' ? 'Работа подтверждена' : review.status === 'cannot-assess' && review.assessmentBasis?.unresolvedReason === 'missing-evidence' ? 'Разбор завершён · часть работы не видна' : review.status === 'cannot-assess' ? 'Итог пока не установлен' : 'Что осталось сделать'}</strong>
      <p>{formatReviewProse(review.nextStep ?? review.summary ?? '')}</p>
    </div>}
    {review && <div className="day-learning-route-progress" aria-label="Состояние проверки фото">
      {mathematics && <><span>Ответ: <b>{review?.mathReasoning?.answer === 'correct' ? 'верен' : review?.mathReasoning?.answer === 'incorrect' ? 'неверен' : 'не подтверждён'}</b></span>
      <span>Ход: <b>{review?.mathReasoning?.argument === 'sufficient' ? 'подтверждён' : review?.mathReasoning?.argument === 'incomplete' ? 'неполон' : review?.mathReasoning?.argument === 'not-shown' ? 'не показан' : review?.mathReasoning?.argument === 'unreadable' ? 'не читается' : 'пока неясен'}</b></span></>}
      <small>{completion && !mathematics ? completion.complete
        ? `${completion.confirmed} из ${completion.required} пунктов подтверждено${completion.optional ? `; ${completion.optional} по желанию` : ''}. Работа выполнена по семейному плану.`
        : `${completion.confirmed} из ${completion.required} пунктов подтверждено${completion.optional ? `; ${completion.optional} по желанию` : ''}.`
        : disputedCriterion ? 'Все части задания предъявлены. Критерий формы спорен; от ребёнка пока ничего не требуется.'
        : firstAttention >= 0 ? `${correct} из ${matched.length} сопоставленных этапов подтверждено; ${guide.stages.length - matched.length} пока без результата. Ниже — первое место, требующее внимания.`
          : `${correct} из ${matched.length} сопоставленных этапов подтверждено; ${guide.stages.length - matched.length} пока без результата.`}</small>
    </div>}
    <div className="day-learning-route-stages">{guide.stages.map((stage, index) => {
      const result = observed.get(stage.id)
      const hintSent = alreadySent(stage, 'hint')
      const revealSent = alreadySent(stage, 'reveal')
      const active = preview?.id === stage.id && !alreadySent(stage, preview.level) ? preview : null
      const previewText = active?.level === 'hint' ? stage.hintPreview : stage.revealPreview
      const checkable = !mathematics && Boolean(review?.checkableStageIds?.includes(stage.id))
      const required = isRequired(stage)
      const choicePending = checkable && (stageSaving === stage.id || stage.id in unresolvedChoices)
      return <div className="day-learning-route-stage-shell" key={stage.id}><details className={`day-learning-route-stage ${result?.status ? `day-learning-route-${result.status}` : ''}${checkable && !required ? ' day-learning-route-optional' : ''}`} open={stageError?.id === stage.id && stageError.reviewVersion === reviewVersion}>
        <summary><span className="day-learning-route-number">{result ? <StatusIcon size={17} status={choicePending ? 'waiting' : checkable && !required ? 'ready' : result.status === 'correct' ? 'complete' : result.status === 'incorrect' ? 'needs-fix' : result.status === 'partial' ? 'partial' : 'unknown'} /> : review ? <StatusIcon size={17} status="unknown" /> : index + 1}</span><span className="day-learning-route-stage-title"><b>{formatReviewProse(stage.title)}</b>{choicePending ? <small role="status">{stageSaving === stage.id ? 'Сохраняем выбор…' : 'Ждём подтверждения…'}</small> : result ? <small>{checkable && !required ? 'По желанию · не входит в итог' : disputedCriterion && result.status === 'cannot-assess' ? 'Критерий формы спорен' : !mathematics && result.status === 'cannot-assess' ? 'Пока не подтверждено' : statusText[result.status]}</small> : review && <small>Этап пока не сопоставлен с проверкой</small>}</span>
        </summary>
        <div className="day-learning-route-body">
          {stageError?.id === stage.id && stageError.reviewVersion === reviewVersion && <p className="day-learning-route-error" role="alert">{stageError.message}</p>}
          {result?.observed && <p className="day-learning-route-observed"><b>В работе:</b> {formatReviewObservation(result.observed)}{result.note && <small className="day-guide-review-note">{formatReviewProse(result.note)}</small>}</p>}
          <GuidanceStageContent content={{ ...stage, sourceLabel: stage.source.label }} />
          {guidanceReady && !revealSent && <div className="day-learning-route-actions">
            {stage.hintPreview && !hintSent && <button type="button" aria-label={`Выбрать подсказку для этапа «${stage.title}»`} onClick={() => { setPreview({ id: stage.id, level: 'hint' }); setError('') }}>Подсказка</button>}
            {stage.revealPreview && !revealSent && <button type="button" aria-label={`Выбрать ${stage.role === 'answer' ? 'показ ответа' : 'показ полного шага'} для этапа «${stage.title}»`} onClick={() => { setPreview({ id: stage.id, level: 'reveal' }); setError('') }}>{stage.role === 'answer' ? 'Ответ' : 'Весь шаг'}</button>}
          </div>}
          {guidanceReady && active && previewText && <div className="day-learning-route-preview"><b>{active.level === 'hint' ? 'Подсказка Пете' : 'Показать Пете'}</b>{active.level === 'hint' ? <p>{formatReviewProse(previewText)}</p> : <><GuidanceStageContent content={projectGuidanceReveal(stage)} showTitle /><p>{formatReviewProse(previewText)}</p></>}<button type="button" disabled={sending || !onSend} onClick={() => void send(stage, active.level)}>{sending ? 'Отправляем…' : 'Отправить Пете'}</button>{!onSend && <small>Отправка пока недоступна.</small>}</div>}
          {hintSent && <p className="day-learning-route-sent" role="status">Подсказка отправлена Пете.</p>}
          {revealSent && <p className="day-learning-route-sent" role="status">{stage.role === 'answer' ? 'Ответ отправлен Пете.' : 'Весь шаг отправлен Пете.'}</p>}
        </div>
      </details>{checkable && <RequirementSwitch label={`Учитывать пункт «${stage.title}» при проверке`} checked={required} disabled={!onStageChoice || Boolean(stageSaving) || stage.id in unresolvedChoices} onChange={(checked) => void chooseStage(stage, checked)} />}</div>
    })}</div>
    {guide.boundary && <p className="day-parent-guide-boundary">{formatReviewProse(guide.boundary)}</p>}
    {error && <p className="day-learning-route-error" role="alert">{error}</p>}
    </div>
  </details>
}
