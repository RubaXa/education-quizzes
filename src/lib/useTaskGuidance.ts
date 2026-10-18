/** @see ../../docs/modules/reviews/subject-aware-guidance.md#math-route
 * @see ../../docs/decisions/weekend-parent-actions-2026-10-18.md */
import { useEffect, useState } from 'react'
import { sendDayGuidance, watchDayGuidance } from './dayGuidance'
import type { DayGuidance } from './dayGuidance'
import type { ParentTaskGuide } from './dayStore'
import { reportUiError } from './uiErrors'

/** One source/history/command binding for the ordinary day and weekend projection.
 * The source token is the same; neither a role-specific URL nor a second event is created.
 */
export function useTaskGuidance(studentToken: string, role: 'checking' | 'none' | 'student' | 'parent', onError: (message: string) => void) {
  const scope = studentToken && (role === 'parent' || role === 'student') ? `${role}:${studentToken}` : ''
  const [snapshot, setSnapshot] = useState<{ scope: string; items: DayGuidance[] }>({ scope: '', items: [] })
  useEffect(() => {
    if (!scope) return
    let active = true
    const stop = watchDayGuidance(studentToken, (items) => {
      if (active) setSnapshot({ scope, items })
    }, (cause) => { if (active) onError(reportUiError(cause, 'Подсказки к заданиям')) })
    return () => { active = false; stop() }
  }, [scope, studentToken, onError])
  const ready = Boolean(scope) && snapshot.scope === scope
  const items = ready ? snapshot.items : []
  function forTask(taskId: string, guide?: ParentTaskGuide) {
    return {
      guidance: items.filter((item) => item.taskId === taskId),
      guidanceReady: ready,
      onSendGuidance: role === 'parent' && ready && guide
        ? (stage: ParentTaskGuide['stages'][number], level: DayGuidance['level']) => sendDayGuidance(studentToken, taskId, guide, stage.id, level)
        : undefined,
    }
  }
  return { items, ready, forTask }
}
