import { useEffect, useState } from 'react'
import { watchParentCompletions } from './parentCompletion'
import type { ParentCompletionEvent } from './parentCompletion'
import { reportUiError } from './uiErrors'

/** Family-visible decisions are separate from the checked solution. @see ../../docs/product/day-page.md#parent-acceptance */
export function useParentCompletions(evidenceKey: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ key: string; events: ParentCompletionEvent[] }>({ key: '', events: [] })
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled || !evidenceKey) return
    return watchParentCompletions(evidenceKey.split('|'), (events) => { setSnapshot({ key: evidenceKey, events }); setError('') },
      (cause) => setError(reportUiError(cause, 'Решения родителя')))
  }, [evidenceKey, enabled])
  return { events: enabled && snapshot.key === evidenceKey ? snapshot.events : [], ready: !enabled || snapshot.key === evidenceKey, error }
}
