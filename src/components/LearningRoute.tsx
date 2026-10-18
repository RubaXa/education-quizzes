/** @see ../../docs/decisions/local-first-role-recovery-2026-10-18.md
 *  @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes
 *  @see ../../docs/decisions/personal-entry-role-confirmation-2026-10-18.md */
import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { clearPersonalSession, loadPersonalProfile, readCachedPersonalContext, rememberPersonalContext, rememberPersonalDashboardRoute, watchPersonalContextChanges } from '@/lib/personalAccess'
import { LearningAccessError, learningHash, loadLearningAccess, readCachedLearningAccess } from '@/lib/learningRoute'
import type { LearningAccess, LearningMode } from '@/lib/learningRoute'
import type { PersonalSession } from '@/lib/personalAccess'
import { reportUiError } from '@/lib/uiErrors'
import { configureRoleDiagnostics } from '@/lib/roleDiagnostics'
import { traceAccessContext, traceAccess, accessTraceError } from '@/lib/browserAccessTrace'
import DayPage from '@/DayPage'
import DayDashboard from '@/DayDashboard'

export default function LearningRoute({ mode, token, headerReturnTarget }: { mode: LearningMode; token: string; headerReturnTarget?: HTMLDivElement | null }) {
  const [access, setAccess] = useState<LearningAccess | undefined>(() => readCachedLearningAccess(mode, token))
  const [error, setError] = useState('')
  const [contextRevision, setContextRevision] = useState(0)
  const [contextAvailable, setContextAvailable] = useState(true)
  useEffect(() => {
    if (access) traceAccessContext('route.selected', { source: 'route', route: mode, role: access.parent ? 'parent' : 'student', reason: 'role-projection' }, { ...access.session, ...access.child })
  }, [access, mode])
  useEffect(() => watchPersonalContextChanges(() => {
    const next = readCachedLearningAccess(mode, token)
    setAccess(next)
    setContextAvailable(Boolean(readCachedPersonalContext()))
    setContextRevision((value) => value + 1)
  }), [mode, token])
  useEffect(() => {
    let active = true
    setAccess(readCachedLearningAccess(mode, token))
    setError('')
    if (!contextAvailable) return
    const stops: Array<() => void> = []
    let revoked = false
    let monitoredSession: PersonalSession | undefined
    let stopDiagnostics = () => {}
    const revoke = () => {
      if (!active) return
      revoked = true
      stopDiagnostics()
      if (clearPersonalSession(monitoredSession) === false) return
      setAccess(undefined)
      setError('Доступ изменился. Откройте свою личную ссылку Education.')
    }
    void loadLearningAccess(mode, token).then((result) => {
      if (!active) return
      setAccess(result)
      const { session, child } = result
      monitoredSession = session
      let current = result
      let refreshing = false
      let memberRole = child.role
      const confirmed = new Set<string>()
      const ready = (part: string) => { confirmed.add(part); if (active && !revoked && !refreshing && confirmed.size === 3) setAccess(current) }
      const remoteError = (cause: { code?: string }) => {
        traceAccess('access.failed', { source: 'route', code: accessTraceError(cause) })
        if (cause.code === 'permission-denied') revoke()
        else { reportUiError(cause, 'Фоновая проверка личного доступа') }
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
        const previousDiagnosticStop = stopDiagnostics
        stopDiagnostics = configureRoleDiagnostics(session, child.familyId, data, current.child.role)
        previousDiagnosticStop()
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
    }).catch((cause) => {
      if (!active) return
      const code = (cause as { code?: string })?.code
      const transient = ['unavailable', 'deadline-exceeded', 'auth/network-request-failed'].includes(code ?? '')
      if (transient && readCachedLearningAccess(mode, token)) { reportUiError(cause, 'Фоновая сверка учебного экрана'); return }
      setAccess(undefined)
      setError(cause instanceof LearningAccessError ? cause.message : reportUiError(cause, 'Личный учебный экран'))
    })
    return () => { active = false; stopDiagnostics(); stops.forEach((stop) => stop()) }
  }, [mode, token, contextRevision, contextAvailable])
  if (error) return <div role="alert">{error} <a href="#/">На главную</a></div>
  if (!access) return null
  return mode === 'days' ? <DayDashboard token={access.token} parent={access.parent} />
    : <DayPage token={access.token} parent={access.parent} headerReturnTarget={headerReturnTarget ?? null} />
}
