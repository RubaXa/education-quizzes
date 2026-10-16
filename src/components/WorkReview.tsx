import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { DayUpload, DayWorkReview } from '@/lib/dayStore'
import { requirementChoice, requiredFamilyActions, stageCompletion } from '@/lib/parentCompletion'
import type { ParentCompletionEvent } from '@/lib/parentCompletion'
import { activeProcessing, elapsedLabel, processingIsStale, reviewHeadline, reviewTone, workCoverageComplete } from '@/lib/reviewPresentation'
import { ArtifactStatusGlyph } from './ArtifactAvatar'
import StatusIcon from './StatusIcon'
import RequirementSwitch from './RequirementSwitch'

const itemLabels = { correct: 'Верно', partial: 'Частично верно', incorrect: 'Неверно', 'cannot-assess': 'Не удалось проверить' }

/**
 * Постоянный компонент читает этап и итог из Firestore. Следующие проверки
 * меняют только данные; открытая страница получает их через onSnapshot.
 * @see ../../docs/product/day-page.md#homework-review
 * @see ../../docs/product/status-presentation.md#components
 * @see ../../docs/product/review-criteria-provenance.md
 */
export default function WorkReview({ review, uploads, accepted = false, canDecide = false, onDecision, decisions = [], onRequirementChoice, parent = false }: {
  review?: DayWorkReview; uploads: DayUpload[]; accepted?: boolean; canDecide?: boolean; onDecision?: (action: 'accept' | 'reopen') => Promise<void>;
  decisions?: ParentCompletionEvent[]; onRequirementChoice?: (requirementId: string, action: 'require' | 'optional') => Promise<void>; parent?: boolean
}) {
  const [saving, setSaving] = useState(false)
  const [decisionError, setDecisionError] = useState('')
  const pending = uploads.filter((upload) => upload.status === 'pending')
  const processing = activeProcessing(review, uploads)
  const [now, setNow] = useState(() => Date.now())
  const paused = processing?.phase === 'paused'
  const stale = Boolean(processing && !paused && processingIsStale(processing, now))
  const running = Boolean(processing && processing.phase !== 'paused' && !stale)
  useEffect(() => {
    if (!pending.length) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [pending.length])
  if (!pending.length && !review?.status) return null

  const requiredActions = requiredFamilyActions(review, decisions)
  const familyStages = stageCompletion(review, decisions)
  const familyDone = Boolean(familyStages?.complete && !pending.length && !requiredActions.length)
  const tone = requiredActions.length ? 'partial' : familyDone || accepted ? 'success' : review?.status ? reviewTone(review) : 'neutral'
  const items = review?.items ?? []
  const feedback = review?.studentFeedback
  const basis = review?.assessmentBasis
  const visibleSources = basis?.sources?.filter((source) => source.kind !== 'official-key') ?? []
  const firstPending = pending.map((upload) => upload.createdAt).find(Boolean)
  const elapsed = processing ? elapsedLabel(processing.startedAt, now) : elapsedLabel(firstPending, now)
  const answer = review?.mathReasoning?.answer
  const argument = review?.mathReasoning?.argument
  const argumentLabel = argument === 'sufficient' ? 'Ход подтверждён' : argument === 'not-required' ? 'Ход не требовался'
    : argument === 'incomplete' ? 'Ход неполон' : argument === 'not-shown' ? 'Ход не показан' : argument === 'unreadable' ? 'Ход не читается' : 'Ход не установлен'

  async function decide(action: 'accept' | 'reopen') {
    if (!onDecision || saving) return
    setSaving(true)
    setDecisionError('')
    try { await onDecision(action) }
    catch (cause) { setDecisionError(cause instanceof Error ? cause.message : 'Не удалось сохранить решение. Попробуйте ещё раз.') }
    finally { setSaving(false) }
  }
  async function chooseRequirement(requirementId: string, action: 'require' | 'optional') {
    if (!onRequirementChoice || saving) return
    setSaving(true)
    setDecisionError('')
    try { await onRequirementChoice(requirementId, action) }
    catch (cause) { setDecisionError(cause instanceof Error ? cause.message : 'Не удалось сохранить решение.') }
    finally { setSaving(false) }
  }

  return <div className="day-review-stack">
    {pending.length > 0 && <div className={`day-review-progress${running ? ' active' : ''}`} role="status" aria-live="polite">
      <span className="day-review-progress-icon"><ArtifactStatusGlyph state={running ? 'processing' : paused || stale ? 'paused' : 'waiting'} size={17} /></span>
      <span className="day-review-progress-text"><b>{stale ? 'Проверка задерживается' : paused ? 'Фото получено · проверка задержана' : processing?.label ?? 'Фото получено · ждёт проверки'}</b><small>{paused ? processing?.reason ?? 'Причина остановки пока не указана. Фото получено; повторно загружать его не нужно.' : running ? 'Разбор идёт' : stale ? 'Последний этап давно не обновлялся' : 'Начнём после запуска проверки'}</small></span>
      {!paused && <time aria-hidden="true">{elapsed}</time>}
    </div>}

    {review?.status && <details className={`day-work-review ${tone}`} open={review.requirementChecks?.length ? true : undefined}>
      <summary>
        <span className="day-work-review-icon"><StatusIcon size={17} status={tone === 'success' ? 'complete' : tone === 'partial' ? 'partial' : tone === 'error' ? 'needs-fix' : 'unknown'} /></span>
        <span className="day-work-review-title"><b>{pending.length ? 'Предыдущая проверка' : 'Итог разбора'}</b><span>{requiredActions.length ? 'Доработать по решению родителя' : familyDone ? `Готово по семейному плану · ${familyStages?.confirmed} из ${familyStages?.required}` : accepted ? 'Засчитано родителем · ход неполон' : reviewHeadline(review)}</span></span>
        <ChevronDown className="day-work-review-chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="day-work-review-body">
        {!!review.requirementChecks?.length && <section className="day-work-review-requirements" aria-label="Проверка требований МЭШ">
          <h4>Что задано в МЭШ и что видно на фото</h4>
          <p>Подтверждено {review.requirementChecks.filter((check) => check.result === 'confirmed').length} из {review.requirementChecks.length} обязательных пунктов. Невидимую часть не считаем ошибкой.</p>
          <ol>{review.requirementChecks.map((check) => <li key={check.id}>
            <strong>{check.action}</strong>
            <span><b>МЭШ:</b> {check.meshExcerpt}</span>
            <span><b>Учебник уточняет:</b> {check.materialExcerpt}</span>
            <span><b>На фото:</b> {check.evidence.observation}</span>
            <span className={`day-work-review-requirement-result ${check.result}`}><StatusIcon size={15} status={check.result === 'confirmed' ? 'complete' : check.result === 'not-met' ? 'needs-fix' : check.result === 'partial' ? 'partial' : 'unknown'} />{check.result === 'confirmed' ? 'Требование выполнено' : check.result === 'unknown' ? 'Не можем установить по фото' : check.result === 'partial' ? 'Часть требования подтверждена' : 'Требование не выполнено'}</span>
            <span>{check.explanation}</span>
          </li>)}</ol>
        </section>}
        {review.mathReasoning && <div className="day-work-review-verdicts" aria-label="Результат проверки">
          <span className={answer === 'correct' ? 'correct' : answer === 'incorrect' ? 'incorrect' : 'unknown'}><StatusIcon size={16} status={answer === 'correct' ? 'complete' : answer === 'incorrect' ? 'incorrect' : 'unknown'} />{answer === 'correct' ? 'Ответ верен' : answer === 'incorrect' ? 'Ответ неверен' : 'Ответ не установлен'}</span>
          <span className={argument === 'sufficient' || argument === 'not-required' ? 'correct' : 'incomplete'}><StatusIcon size={16} status={argument === 'sufficient' || argument === 'not-required' ? 'complete' : 'partial'} />{argumentLabel}</span>
        </div>}
        {familyDone && <p className="day-work-review-accepted">Все пункты семейного плана подтверждены. {familyStages?.optional ? `${familyStages.optional} пункт(а) оставлены по желанию родителя.` : ''} Исходный разбор фото сохранён.</p>}
        {accepted && <p className="day-work-review-accepted">Задача завершена по решению родителя. Ответ верен; обоснование хода в работе осталось неполным.</p>}
        {basis?.outcome === 'unresolved' && <p className="day-work-review-unprepared">{workCoverageComplete(review) ? `Работа предъявлена полностью: ${review.workCoverage?.note} ` : `Разбор загруженного фото завершён. ${review.summary ?? ''} `}{requiredActions.length ? 'Родитель назначил доработку для семейного плана; она указана ниже.' : workCoverageComplete(review) ? 'Дополнительных действий от ученика сейчас не требуется.' : review.nextStep ?? 'Если есть другая страница работы, добавьте её фото для проверки.'}</p>}
        {basis?.disputedRequirements?.map((item) => {
          const choice = requirementChoice(review, item.id, decisions)
          if (!parent && !choice) return null
          return <section className="day-work-review-dispute" key={item.id}>
            <strong>{parent ? item.action : choice === 'require' ? `Сделай по решению родителя: ${item.action}` : `Можно по желанию: ${item.action}`}</strong>
            {parent && item.meshExcerpt && <><p><b>МЭШ:</b> «{item.meshExcerpt}»</p><p><b>{item.sourceKind === 'textbook' ? 'Учебник' : 'Предположение Education'}:</b> «{item.sourceExcerpt}»</p><p>{item.uncertainty}</p><small>{item.sourceRef}</small></>}
            <p><b>Решение семьи:</b> {choice === 'require' ? 'Доработать' : 'По желанию'}</p>
            {parent && <RequirementSwitch label={`Учитывать доработку «${item.action}» в семейном плане`} checked={choice === 'require'} disabled={!canDecide || saving} onChange={(checked) => void chooseRequirement(item.id, checked ? 'require' : 'optional')} />}
          </section>
        })}
        {decisionError && <small role="alert">{decisionError}</small>}
        {!accepted && !familyDone && feedback ? <div className="day-work-review-feedback">
          <p><b>Уже получилось</b><span>{feedback.confirmed}</span></p>
          <p><b>Проверь здесь</b><span>{feedback.focus}</span></p>
          <p><b>Один вопрос</b><span>{feedback.question}</span></p>
        </div> : !accepted && (review.status === 'needs-fix' || review.status === 'partial')
          ? <p className="day-work-review-unprepared">Работа проверена. Адресный вопрос к этой попытке ещё уточняется.</p>
          : null}
        {basis?.requirement && !review.requirementChecks?.length && <div className="day-work-review-basis">
          <p><b>Что требовалось</b><span>{basis.requirement}</span></p>
          <p><b>Что видно в работе</b><span>{basis.observed}</span></p>
          <p><b>{basis.outcome === 'unresolved' ? 'Что осталось неясным' : 'Почему такой результат'}</b><span>{basis.comparison}</span></p>
          {(visibleSources.length > 0 || basis.limitation) && <details><summary>На чём основана проверка</summary>{visibleSources.length > 0 && <ul>{visibleSources.map((source, index) => <li key={`${source.ref}-${index}`}><b>{source.kind === 'mesh' ? 'МЭШ' : source.kind === 'textbook' ? 'Учебник' : source.kind === 'teacher' ? 'Учитель' : source.kind === 'curriculum' ? 'Программа' : 'Методическое пособие'}</b>: «{source.excerpt}» <small>{source.ref}</small></li>)}</ul>}{basis.limitation && <p>{basis.limitation}</p>}</details>}
        </div>}
        {!review.requirementChecks?.length && !feedback && review.status !== 'needs-fix' && review.status !== 'partial' && items.length > 0 && <ol>{items.map((item, index) => <li className={`day-work-review-item ${item.status}`} key={`${item.label}-${index}`}>
          <span className="day-work-review-item-icon"><StatusIcon size={14} status={item.status === 'correct' ? 'complete' : item.status === 'incorrect' ? 'incorrect' : item.status === 'partial' ? 'partial' : 'unknown'} /></span>
          <div><strong>{item.label} · {basis?.outcome === 'unresolved' && item.status === 'cannot-assess' ? basis.unresolvedReason === 'missing-evidence' ? 'Не видно на фото' : basis.unresolvedReason === 'criterion-unclear' ? 'Критерий требует уточнения' : 'Итог не установлен' : itemLabels[item.status]}</strong>{item.observed && <small><b>В работе:</b> {item.observed}</small>}</div>
        </li>)}</ol>}
        {!!review.history?.length && <details className="day-review-history"><summary>Предыдущие попытки · {review.history.length}</summary><ol>{[...review.history].reverse().map((entry, index) => <li key={index}><strong>{entry.studentFeedback?.title ?? (entry.status === 'verified' ? 'Верно' : entry.status === 'partial' ? 'Частично' : entry.status === 'needs-fix' ? 'Нужна правка' : 'Не удалось оценить')}</strong>{entry.studentFeedback?.focus && <small>{entry.studentFeedback.focus}</small>}</li>)}</ol></details>}
        {onDecision && <div className="day-review-parent-decision">
          <button type="button" disabled={!canDecide || saving} onClick={() => void decide(accepted ? 'reopen' : 'accept')}>{saving ? 'Сохраняем…' : accepted ? 'Вернуть задачу в работу' : 'Засчитать задачу'}</button>
          {!canDecide && <small>{pending.length ? 'Сначала дождитесь проверки нового фото.' : 'Для решения откройте личную ссылку родителя.'}</small>}
          {decisionError && <small role="alert">{decisionError}</small>}
        </div>}
      </div>
    </details>}
  </div>
}
