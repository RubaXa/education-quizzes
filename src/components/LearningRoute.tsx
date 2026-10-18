/** @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes
 *  @see ../../docs/decisions/personal-entry-role-confirmation-2026-10-18.md */
import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { clearPersonalSession, loadPersonalProfile, rememberPersonalContext, rememberPersonalDashboardRoute } from '@/lib/personalAccess'
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
    setAccess(undefined)
    setError('')
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
      let current = result
      let refreshing = false
      let memberRole = child.role
      const confirmed = new Set<string>()
      const ready = (part: string) => { confirmed.add(part); if (active && !revoked && !refreshing && confirmed.size === 3) setAccess(current) }
      const remoteError = (cause: { code?: string }) => {
        if (cause.code === 'permission-denied') revoke()
        else { revoked = true; setAccess(undefined); setError(reportUiError(cause, 'Проверка личного доступа')) }
      }
      stops.push(onSnapshot(doc(db, 'accessLinks', session.linkToken), { includeMetadataChanges: true }, (grant) => {
        if (!grant.metadata.fromCache && (!grant.exists() || grant.data()?.active !== true || grant.data()?.personId !== session.personId)) revoke()
        else if (!grant.metadata.fromCache) ready('grant')
      }, remoteError))
      stops.push(onSnapshot(doc(db, 'deviceSessions', session.deviceUid), { includeMetadataChanges: true }, (device) => {
        if (!device.metadata.fromCache && (!device.exists() || device.data()?.linkToken !== session.linkToken)) revoke()
        else if (!device.metadata.fromCache) ready('device')
      }, remoteError))
      stops.push(onSnapshot(doc(db, 'families', child.familyId, 'members', session.personId), { includeMetadataChanges: true }, (member) => {
        if (member.metadata.fromCache || !active || revoked) return
        const data = member.data()
        if (!member.exists() || data?.active !== true || !['parent', 'student'].includes(data?.role)
          || !Array.isArray(data?.childIds) || !data.childIds.includes(child.childId)) { revoke(); return }
        memberRole = data.role
        if (memberRole === current.child.role && !refreshing) { ready('member'); return }
        confirmed.delete('member')
        setAccess(undefined)
        if (refreshing) return
        refreshing = true
        // A valid role change is not a revoked login. Reconcile the stale profile once.
        void loadPersonalProfile(session).then(async (profile) => {
          if (!active || revoked) return
          rememberPersonalContext({ session, profile })
          const updated = await loadLearningAccess(mode, token)
          if (!active || revoked) return
          if (updated.child.familyId !== child.familyId || updated.child.childId !== child.childId
            || updated.child.role !== memberRole) { revoke(); return }
          current = updated
          refreshing = false
          ready('member')
        }).catch(remoteError)
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
