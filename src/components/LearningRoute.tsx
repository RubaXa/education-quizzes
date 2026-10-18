/** @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes */
import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { clearPersonalSession, rememberPersonalDashboardRoute } from '@/lib/personalAccess'
import { LearningAccessError, learningHash, loadLearningAccess } from '@/lib/learningRoute'
import type { LearningAccess, LearningMode } from '@/lib/learningRoute'
import { reportUiError } from '@/lib/uiErrors'
import DayPage from '@/DayPage'
import DayDashboard from '@/DayDashboard'

export default function LearningRoute({ mode, token, headerReturnTarget }: { mode: LearningMode; token: string; headerReturnTarget?: HTMLDivElement | null }) {
  const [access, setAccess] = useState<LearningAccess>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const stops: Array<() => void> = []
    let revoked = false
    const revoke = () => {
      if (!active) return
      revoked = true
      clearPersonalSession()
      setAccess(undefined)
      setError('Доступ изменился. Откройте свою личную ссылку Education.')
    }
    void loadLearningAccess(mode, token).then((result) => {
      if (!active) return
      const { session, child } = result
      const confirmed = new Set<string>()
      const ready = (part: string) => { confirmed.add(part); if (active && !revoked && confirmed.size === 3) setAccess(result) }
      const remoteError = (cause: { code?: string }) => {
        if (cause.code === 'permission-denied') revoke()
        else { revoked = true; setAccess(undefined); setError(reportUiError(cause, 'Проверка личного доступа')) }
      }
      stops.push(onSnapshot(doc(db, 'accessLinks', session.linkToken), (grant) => {
        if (!grant.metadata.fromCache && (!grant.exists() || grant.data()?.active !== true || grant.data()?.personId !== session.personId)) revoke()
        else if (!grant.metadata.fromCache) ready('grant')
      }, remoteError))
      stops.push(onSnapshot(doc(db, 'deviceSessions', session.deviceUid), (device) => {
        if (!device.metadata.fromCache && (!device.exists() || device.data()?.linkToken !== session.linkToken)) revoke()
        else if (!device.metadata.fromCache) ready('device')
      }, remoteError))
      stops.push(onSnapshot(doc(db, 'families', child.familyId, 'members', session.personId), (member) => {
        if (!member.metadata.fromCache && (!member.exists() || member.data()?.active !== true || member.data()?.role !== child.role || !member.data()?.childIds?.includes(child.childId))) revoke()
        else if (!member.metadata.fromCache) ready('member')
      }, remoteError))
      const canonical = learningHash(mode, result.canonicalToken)
      if (location.hash !== canonical) history.replaceState(history.state, '', `${location.pathname}${location.search}${canonical}`)
      if (mode === 'days') rememberPersonalDashboardRoute(canonical)
    }).catch((cause) => { if (active) setError(cause instanceof LearningAccessError ? cause.message : reportUiError(cause, 'Личный учебный экран')) })
    return () => { active = false; stops.forEach((stop) => stop()) }
  }, [mode, token])
  if (error) return <div role="alert">{error} <a href="#/">На главную</a></div>
  if (!access) return <p>Проверяем личный доступ к учебному экрану…</p>
  return mode === 'days' ? <DayDashboard token={access.token} parent={access.parent} />
    : <DayPage token={access.token} parent={access.parent} headerReturnTarget={headerReturnTarget ?? null} />
}
