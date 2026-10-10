import { useEffect, useState } from 'react'
import { Check, ChevronDown, CircleAlert, Minus, X } from 'lucide-react'
import type { DayUpload, DayWorkReview } from '@/lib/dayStore'
import { activeProcessing, elapsedLabel, processingIsStale, reviewHeadline, reviewTone } from '@/lib/reviewPresentation'
import { ArtifactStatusGlyph } from './ArtifactAvatar'

const itemLabels = { correct: 'Верно', partial: 'Частично верно', incorrect: 'Неверно', 'cannot-assess': 'Не удалось проверить' }

/**
 * Постоянный компонент читает этап и итог из Firestore. Следующие проверки
 * меняют только данные; открытая страница получает их через onSnapshot.
 * @see ../../docs/product/day-page.md#homework-review
 */
export default function WorkReview({ review, uploads }: { review?: DayWorkReview; uploads: DayUpload[] }) {
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

  const tone = review?.status ? reviewTone(review) : 'neutral'
  const items = review?.items ?? []
  const firstPending = pending.map((upload) => upload.createdAt).find(Boolean)
  const elapsed = processing ? elapsedLabel(processing.startedAt, now) : elapsedLabel(firstPending, now)

  return <div className="day-review-stack">
    {pending.length > 0 && <div className={`day-review-progress${running ? ' active' : ''}`} role="status" aria-live="polite">
      <span className="day-review-progress-icon"><ArtifactStatusGlyph state={running ? 'processing' : paused || stale ? 'paused' : 'waiting'} size={17} /></span>
      <span className="day-review-progress-text"><b>{stale ? 'Проверка задерживается' : paused ? 'Фото получено · проверка задержана' : processing?.label ?? 'Фото получено · ждёт проверки'}</b><small>{paused ? processing?.reason ?? 'Причина остановки пока не указана. Фото получено; повторно загружать его не нужно.' : running ? 'Разбор идёт' : stale ? 'Последний этап давно не обновлялся' : 'Начнём после запуска проверки'}</small></span>
      {!paused && <time aria-hidden="true">{elapsed}</time>}
    </div>}

    {review?.status && <details className={`day-work-review ${tone}`}>
      <summary>
        <span className="day-work-review-icon">{tone === 'success' ? <Check size={17} aria-hidden="true" /> : tone === 'partial' ? <Minus size={17} aria-hidden="true" /> : tone === 'error' ? <X size={17} aria-hidden="true" /> : <CircleAlert size={17} aria-hidden="true" />}</span>
        <span className="day-work-review-title"><b>{pending.length ? 'Предыдущая проверка' : 'Проверка работы'}</b><span>{reviewHeadline(review)}</span></span>
        <ChevronDown className="day-work-review-chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="day-work-review-body">
        {review.mathReasoning && <div className="day-work-review-reasoning">
          <p><b>Ответ:</b> {review.mathReasoning.answer === 'correct' ? 'верен' : review.mathReasoning.answer === 'incorrect' ? 'есть ошибка' : 'пока не установлен'}</p>
          <p><b>Ход решения:</b> {review.mathReasoning.argument === 'sufficient' ? 'достаточен для проверки' : review.mathReasoning.argument === 'incomplete' ? 'нужен один переход' : review.mathReasoning.argument === 'not-shown' ? 'на фото не показан' : review.mathReasoning.argument === 'not-required' ? 'не требовался в условии' : 'не удалось прочитать'}</p>
          <p><b>На фото:</b> {review.mathReasoning.observed}</p>
        </div>}
        {items.length > 0 && <ol>{items.map((item, index) => <li className={`day-work-review-item ${item.status}`} key={`${item.label}-${index}`}>
          <span className="day-work-review-item-icon">{item.status === 'correct' ? <Check size={14} aria-hidden="true" /> : item.status === 'incorrect' ? <X size={14} aria-hidden="true" /> : item.status === 'partial' ? <Minus size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}</span>
          <div><strong>{item.label} · {itemLabels[item.status]}</strong>{item.observed && <small><b>В работе:</b> {item.observed}</small>}</div>
        </li>)}</ol>}
        {(review.status === 'partial' || review.status === 'needs-fix') && <p className="day-work-review-next"><b>Для новой попытки:</b> Начни с первого отмеченного пункта. Сравни свою запись с условием и найди, где связь между ними потерялась.</p>}
        {!!review.history?.length && <details className="day-review-history"><summary>Предыдущие попытки · {review.history.length}</summary><ol>{[...review.history].reverse().map((entry, index) => <li key={index}><strong>{entry.status === 'verified' ? 'Верно' : entry.status === 'partial' ? 'Частично' : entry.status === 'needs-fix' ? 'Нужна правка' : 'Не удалось оценить'}</strong></li>)}</ol></details>}
      </div>
    </details>}
  </div>
}
