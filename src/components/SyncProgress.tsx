import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import './SyncProgress.css'

type SyncPhase = 'queued' | 'fetching' | 'awaiting-review' | 'enriching' | 'publishing' | 'verifying' | 'complete' | 'blocked'
type SyncState = { phase: SyncPhase; checkedDates?: number; totalDates?: number; reason?: string | null; updatedAt?: { toDate?: () => Date };
  queue?: { queued?: number; processing?: number; blocked?: number; byKind?: Record<string, number>; blockedReasons?: Record<string, number> } }
const segment = (value: string) => /^[A-Za-z0-9_-]{1,120}$/.test(value)
const jobLabels: Record<string, string> = {
  'reconcile-day': 'Сверить и опубликовать день', 'review-work': 'Проверить работу',
  'transfer-work': 'Передать фото', 'review-quiz': 'Проверить открытые ответы теста',
  'ingest-book': 'Обработать учебник', 'publish-book-pages': 'Опубликовать страницы',
  'classify-assignment': 'Уточнить вид задания и тему',
  'prepare-quiz': 'Подготовить самопроверку',
  'prepare-control-followup': 'Подготовить второй тест к контрольной',
  'enrich-task': 'Уточнить задание',
  'material-needed': 'Нужны страницы рабочей тетради',
  'triage-help': 'Разобрать запрос помощи', 'repair-review': 'Восстановить связь разбора',
}
const blockedLabels: Record<string, string> = {
  'family-workbook-pages-required': 'Нужен PDF назначенной рабочей тетради',
  'parent-hint-decision-required': 'Нужно решение родителя о подсказке',
}

function label(value: SyncState) {
  switch (value.phase) {
    case 'queued': return 'Обновление данных поставлено в очередь'
    case 'fetching': return `Получаем данные МЭШ${Number.isInteger(value.checkedDates) && Number.isInteger(value.totalDates) ? ` · ${value.checkedDates} из ${value.totalDates} дат` : ''}`
    case 'awaiting-review': return ''
    case 'enriching': return 'Сверяем задания с учебниками и источниками'
    case 'publishing': return 'Публикуем проверенные изменения'
    case 'verifying': return 'Проверяем опубликованные данные'
    case 'complete': return ''
    case 'blocked': return value.reason === 'auth-required' ? 'Обновление ждёт повторного подключения МЭШ'
      : value.reason === 'rate-limited' ? 'МЭШ временно ограничил запросы'
        : value.reason === 'scoped-publisher-required' ? 'Данные получены; публикация для этой семьи готовится'
          : value.reason === 'incomplete-mesh' ? 'МЭШ не отдал часть урока. Сбор остановлен; повторим при следующем запуске.'
            : 'Сбор остановлен. Причина записана для оператора.'
  }
}

/** @see ../../docs/product/global-sync.md#status
 *  @see ../../docs/product/design-system.md#cards-and-status */
export function SyncProgress({ familyId, childId }: { familyId: string; childId: string }) {
  const [state, setState] = useState<SyncState | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!segment(familyId) || !segment(childId)) return
    return onSnapshot(doc(db, 'families', familyId, 'children', childId, 'syncStatus', 'current'),
      (snapshot) => {
        const data = snapshot.data() as SyncState | undefined
        setFailed(false)
        setState(data && ['queued', 'fetching', 'awaiting-review', 'enriching', 'publishing', 'verifying', 'complete', 'blocked'].includes(data.phase) ? data : null)
      }, () => { setState(null); setFailed(true) })
  }, [familyId, childId, attempt])
  if (failed) return <div className="edu-sync-progress edu-sync-progress-blocked" role="status">
    Не удалось получить статус обновления. <button type="button" onClick={() => setAttempt((value) => value + 1)}>Повторить</button>
  </div>
  if (!state) return null
  const queue = state.queue
  const queueTotal = (queue?.queued ?? 0) + (queue?.processing ?? 0) + (queue?.blocked ?? 0)
  if (!queueTotal && (state.phase === 'awaiting-review' || state.phase === 'complete')) return null
  const phaseLabel = state.phase === 'awaiting-review' || state.phase === 'complete' ? '' : label(state)
  return <div className={`edu-sync-progress edu-sync-progress-${state.phase}`} role="status" aria-live="polite">
    <span className="edu-sync-progress-dot" aria-hidden="true" />
    {phaseLabel && <span>{phaseLabel}</span>}
    {queueTotal > 0 && <details className="edu-sync-queue"><summary>{queue?.processing ? `В работе ${queue.processing} · ` : ''}{queue?.queued ? `В очереди ${queue.queued}` : ''}{queue?.queued && queue?.blocked ? ' · ' : ''}{queue?.blocked ? `Остановлено ${queue.blocked}` : ''}</summary>
      <ul>{Object.entries(queue?.byKind ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([kind, count]) => <li key={kind}>{jobLabels[kind] ?? 'Уточнить событие'}: {count}</li>)}
        {Object.entries(queue?.blockedReasons ?? {}).map(([reason, count]) => <li key={reason}>{blockedLabels[reason] ?? 'Остановлено до уточнения источника'}: {count}</li>)}</ul>
    </details>}
    {state.phase === 'fetching' && Number.isInteger(state.checkedDates) && Number.isInteger(state.totalDates) && state.totalDates! > 0
      && <progress max={state.totalDates} value={state.checkedDates} aria-label="Проверенные даты МЭШ" />}
  </div>
}
