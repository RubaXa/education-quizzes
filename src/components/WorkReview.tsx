import { useEffect, useState } from 'react'
import { Check, ChevronDown, CircleAlert, Clock3, LoaderCircle, Minus, X } from 'lucide-react'
import type { DayUpload, DayWorkReview } from '@/lib/dayStore'
import { activeProcessing, elapsedLabel, reviewHeadline, reviewTone, timestampMillis } from '@/lib/reviewPresentation'

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
  const stale = Boolean(processing && now - (timestampMillis(processing.updatedAt) ?? now) > 30 * 60 * 1000)
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
  const elapsed = processing ? elapsedLabel(processing.startedAt, processing.phase === 'paused' ? timestampMillis(processing.updatedAt) ?? now : now) : elapsedLabel(firstPending, now)

  return <div className="day-review-stack">
    {pending.length > 0 && <div className={`day-review-progress${running ? ' active' : ''}`} role="status" aria-live="polite">
      <span className="day-review-progress-icon">{running ? <LoaderCircle size={17} aria-hidden="true" /> : <Clock3 size={17} aria-hidden="true" />}</span>
      <span className="day-review-progress-text"><b>{stale ? 'Проверка задерживается' : processing?.label ?? 'Фото получено · ждёт проверки'}</b><small>{running ? 'Разбор идёт' : stale ? 'Последний этап давно не обновлялся' : processing ? 'Продолжим после устранения причины' : 'Начнём после запуска проверки'}</small></span>
      <time aria-hidden="true">{elapsed}</time>
    </div>}

    {review?.status && <details className={`day-work-review ${tone}`}>
      <summary>
        <span className="day-work-review-icon">{tone === 'success' ? <Check size={17} aria-hidden="true" /> : tone === 'partial' ? <Minus size={17} aria-hidden="true" /> : tone === 'error' ? <X size={17} aria-hidden="true" /> : <CircleAlert size={17} aria-hidden="true" />}</span>
        <span className="day-work-review-title"><b>{pending.length ? 'Предыдущая проверка' : 'Проверка работы'}</b><span>{reviewHeadline(review)}</span></span>
        <ChevronDown className="day-work-review-chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="day-work-review-body">
        {review.summary && <p>{review.summary}</p>}
        {items.length > 0 && <ol>{items.map((item, index) => <li className={`day-work-review-item ${item.status}`} key={`${item.label}-${index}`}>
          <span className="day-work-review-item-icon">{item.status === 'correct' ? <Check size={14} aria-hidden="true" /> : item.status === 'incorrect' ? <X size={14} aria-hidden="true" /> : item.status === 'partial' ? <Minus size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}</span>
          <div><strong>{item.label} · {itemLabels[item.status]}</strong><p>{item.note}</p>{item.observed && <small><b>В работе:</b> {item.observed}</small>}{item.expected && <small><b>По источнику:</b> {item.expected}</small>}</div>
        </li>)}</ol>}
        {review.nextStep && <p className="day-work-review-next"><b>Что дальше:</b> {review.nextStep}</p>}
        {review.source && <small className="day-work-review-source">Источник: {review.source}</small>}
      </div>
    </details>}
  </div>
}
