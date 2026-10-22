/** @see ../../docs/modules/families/early-development.md */
/** @see ../../docs/decisions/local-first-role-recovery-2026-10-18.md */
import { useEffect, useRef, useState } from 'react'
import { getAuth } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { Check, ClipboardPaste, Copy, KeyRound } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { clearPersonalSession, recoverPersonalContext, loadPersonalProfile, personalEntryUrl, readCachedPersonalContext, redeemPersonalLink, rememberPersonalContext, restorePersonalContext, secretFromPastedPersonalLink, watchPersonalContextChanges } from '../lib/personalAccess'
import type { PersonalProfile, PersonalSession } from '../lib/personalAccess'
import { db } from '../lib/firebase'
import EarlyDevelopmentPage from './EarlyDevelopmentPage'
import DayDashboard from '../DayDashboard'
import { ParentHome } from './ParentHome'
import { reportUiError } from '@/lib/uiErrors'
import { configureRoleDiagnostics } from '@/lib/roleDiagnostics'
import { traceAccess, traceAccessContext, traceProfile, accessTraceError } from '@/lib/browserAccessTrace'

function accessError(cause: unknown): string {
  const detail = reportUiError(cause, 'Личный вход')
  if (cause && typeof cause === 'object' && 'code' in cause) {
    if (cause.code === 'auth/operation-not-allowed' || cause.code === 'auth/configuration-not-found') {
      return 'Вход по личным ссылкам ещё не включён в Firebase.'
    }
    if (cause.code === 'permission-denied') return 'Личная ссылка закрыта или отозвана. Попросите новую ссылку.'
    if (cause.code === 'auth/network-request-failed' || cause.code === 'unavailable') {
      return 'Не удалось связаться с Firebase. Проверьте интернет и повторите вход.'
    }
  }
  return cause instanceof Error && !('code' in cause) ? cause.message : detail
}

function transientAccessError(cause: unknown): boolean {
  return Boolean(cause && typeof cause === 'object' && 'code' in cause
    && ['auth/network-request-failed', 'unavailable', 'deadline-exceeded'].includes(String(cause.code)))
}

/** @see ../../docs/modules/families/README.md#link-login
 *  @see ../../docs/modules/families/README.md#parent-home
 *  @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes
 *  @see ../../docs/decisions/personal-entry-role-confirmation-2026-10-18.md
 *  @see ../../docs/shared/design/README.md#shell */
export function PersonalEntry({ initialLink, earlyTarget }: { initialLink?: string; earlyTarget?: { familyId: string; childId: string } }) {
  const [initialContext] = useState(() => {
    if (initialLink) return null
    const cached = readCachedPersonalContext()
    const knownUid = getAuth().currentUser?.uid
    return cached && (!knownUid || knownUid === cached.session.deviceUid) ? cached : null
  })
  const [link, setLink] = useState('')
  const [profile, setProfile] = useState<PersonalProfile | null>(initialContext?.profile ?? null)
  const [session, setSession] = useState<PersonalSession | null>(initialContext?.session ?? null)
  // Render this device's last saved view immediately; validate remotely in background.
  const [verifiedSession, setVerifiedSession] = useState<PersonalSession | null>(null)
  const [invalidProfile, setInvalidProfile] = useState<PersonalProfile | null>(null)
  const [invalidSession, setInvalidSession] = useState<PersonalSession | null>(null)
  const [busy, setBusy] = useState(!initialContext)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [retry, setRetry] = useState(0)
  const [retryable, setRetryable] = useState(false)
  const [contextAvailable, setContextAvailable] = useState(true)
  const automaticRetries = useRef(0)
  const pendingLink = useRef<string | null>(null)
  const initialLinkToRedeem = useRef(initialLink)
  const [copied, setCopied] = useState(false)
  const [selectedChild, setSelectedChild] = useState<string | null>(null)
  const [manualEntry, setManualEntry] = useState(false)
  const manualInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (profile) traceProfile(profile, session?.deviceUid, initialContext?.profile === profile ? 'local' : 'profile', 'PersonalEntry#profileEffect')
    traceAccess('role.selected', { atFunction: 'PersonalEntry#profileEffect', previousState: 'resolved', state: 'selected', source: 'entry', role: profile ? profile.children.some((child) => child.role === 'parent') ? 'parent' : 'student' : 'none', reason: profile ? 'ready' : 'waiting' })
  }, [profile, session, initialContext])

  useEffect(() => watchPersonalContextChanges(() => {
    initialLinkToRedeem.current = undefined
    const cached = readCachedPersonalContext()
    const uid = getAuth().currentUser?.uid
    const next = cached && (!uid || uid === cached.session.deviceUid) ? cached : null
    setSession(next?.session ?? null)
    setProfile(next?.profile ?? null)
    setContextAvailable(Boolean(next))
    setInvalidProfile(null)
    setInvalidSession(null)
    setError('')
    setRetry((value) => value + 1)
  }), [])

  useEffect(() => {
    const reconnect = () => { setOnline(true); if (!profile) setRetry((value) => value + 1) }
    const disconnect = () => setOnline(false)
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', disconnect)
    return () => {
      window.removeEventListener('online', reconnect)
      window.removeEventListener('offline', disconnect)
    }
  }, [profile])

  useEffect(() => {
    // Removal can be the first half of a sibling tab's login. Do not restore
    // its previous server binding while that replacement is still in flight.
    if (!contextAvailable) { setBusy(false); return }
    let alive = true
    let retryTimer: number | undefined
    const open = async () => {
      setBusy(true)
      setError('')
      setRetryable(false)
      try {
        const loginLink = initialLinkToRedeem.current
        // The bearer secret is removed from browser history as soon as we have captured it.
        if (loginLink) history.replaceState(null, '', `${location.pathname}${location.search}#/`)
        const restored = loginLink ? await redeemPersonalLink(loginLink) : null
        const context = loginLink ? restored ? { session: restored, profile: await loadPersonalProfile(restored) } : null : await restorePersonalContext()
        if (!alive) return
        if (context) {
          if (loginLink) rememberPersonalContext(context)
          initialLinkToRedeem.current = undefined
          setSession((previous) => previous?.linkToken === context.session.linkToken && previous.deviceUid === context.session.deviceUid ? previous : context.session)
          setProfile((previous) => JSON.stringify(previous) === JSON.stringify(context.profile) ? previous : context.profile)
          automaticRetries.current = 0
        } else if (initialContext) {
          if (clearPersonalSession(initialContext.session) === false) return
          setSession(null)
          setProfile(null)
        }
      } catch (cause) {
        if (alive) {
          setError(accessError(cause))
          const transient = transientAccessError(cause)
          setRetryable(transient)
          // navigator.onLine can remain true during a brief Firebase outage.
          // Retry only a few times; do not turn a failed login into a read loop.
          if (transient && automaticRetries.current < 3) {
            const delay = [2_000, 5_000, 15_000][automaticRetries.current++]
            retryTimer = window.setTimeout(() => { if (alive) setRetry((value) => value + 1) }, delay)
          }
        }
      } finally {
        if (alive) setBusy(false)
      }
    }
    void open()
    return () => { alive = false; if (retryTimer) window.clearTimeout(retryTimer) }
  }, [initialLink, retry, initialContext, contextAvailable])

  useEffect(() => {
    if (!session) return
    let active = true
    let invalid = false
    const stops: Array<() => void> = []
    setVerifiedSession(null)
    setInvalidSession(null)
    const revoked = () => {
      if (!active || invalid) return
      invalid = true
      setVerifiedSession(null)
      setInvalidSession(session)
      void recoverPersonalContext(session).then((recovered) => {
        if (!active || recovered) return
        if (clearPersonalSession(session) === false) return
        setInvalidProfile(null)
        setInvalidSession(null)
        setSession(null)
        setProfile(null)
        setRetryable(false)
        setError('Личная ссылка отозвана. Откройте новую ссылку, чтобы снова войти. Ваши работы сохранены.')
      }).catch((cause) => {
        if (!active) return
        setError(accessError(cause)); setRetryable(true)
      })
    }
    const failed = (cause: { code?: string }) => {
      traceAccess('access.failed', { atFunction: 'PersonalEntry#accessSnapshot', previousState: 'checking', state: 'failed', source: 'entry', code: accessTraceError(cause) })
      if (!active || invalid) return
      if (cause.code === 'permission-denied') revoked()
      else { setError(accessError(cause)); setRetryable(true) }
    }
    void getAuth().authStateReady().then(() => {
      if (!active) return
      if (getAuth().currentUser?.uid !== session.deviceUid) { revoked(); return }
      setVerifiedSession(session)
      stops.push(onSnapshot(doc(db, 'accessLinks', session.linkToken), { includeMetadataChanges: true }, (grant) => {
        const matches = grant.exists() && grant.data()?.active === true && grant.data()?.personId === session.personId
        traceAccessContext('access.resolved', { atFunction: 'PersonalEntry#accessSnapshot', previousState: 'checking', state: grant.metadata.fromCache ? 'cached' : matches ? 'resolved' : 'changed', source: 'grant-server', fromCache: grant.metadata.fromCache, matches }, session)
        if (grant.metadata.fromCache || !active || invalid) return
        if (!grant.exists() || grant.data()?.active !== true || grant.data()?.personId !== session.personId) revoked()
      }, failed))
      stops.push(onSnapshot(doc(db, 'deviceSessions', session.deviceUid), { includeMetadataChanges: true }, (device) => {
        const matches = device.exists() && device.data()?.linkToken === session.linkToken
        traceAccessContext('access.resolved', { atFunction: 'PersonalEntry#accessSnapshot', previousState: 'checking', state: device.metadata.fromCache ? 'cached' : matches ? 'resolved' : 'changed', source: 'device-server', fromCache: device.metadata.fromCache, matches }, session)
        if (device.metadata.fromCache || !active || invalid) return
        if (!device.exists() || device.data()?.linkToken !== session.linkToken) revoked()
      }, failed))
    }).catch(failed)
    return () => { active = false; stops.forEach((stop) => stop()) }
  }, [session, retry])

  useEffect(() => {
    if (!session || !profile || verifiedSession !== session) return
    let active = true
    let refreshing = false
    const familyIds = [...new Set(profile.children.map((child) => child.familyId))]
    const diagnosticStops = new Map<string, () => void>()
    const stops = familyIds.map((familyId) => onSnapshot(doc(db, 'families', familyId, 'members', session.personId), { includeMetadataChanges: true }, (member) => {
      if (member.metadata.fromCache || !active) return
      const previous = profile.children.filter((child) => child.familyId === familyId)
      const previousDiagnosticStop = diagnosticStops.get(familyId)
      diagnosticStops.set(familyId, configureRoleDiagnostics(session, familyId, member.data() ?? {}, previous[0]?.role ?? 'unknown'))
      previousDiagnosticStop?.()
      const earlyIds = member.data()?.role === 'parent' && Array.isArray(member.data()?.earlyChildIds) ? member.data()!.earlyChildIds as string[] : []
      const ids = Array.isArray(member.data()?.childIds) ? [...new Set([...member.data()!.childIds, ...earlyIds])].filter((id: unknown): id is string => typeof id === 'string').sort() : []
      const changed = !member.exists() || member.data()?.active !== true ||
        member.data()?.role !== previous[0]?.role ||
        JSON.stringify(ids) !== JSON.stringify(previous.map((child) => child.childId).sort())
        || previous.some((child) => (child.learningMode === 'early-development') !== earlyIds.includes(child.childId))
      if (!changed) {
        return
      }
      setInvalidProfile(profile)
      if (refreshing) return
      refreshing = true
      // One reconciliation on a confirmed mismatch, not a periodic full-profile read.
      void loadPersonalProfile(session).then((updated) => {
        if (!active) return
        if (JSON.stringify(updated) === JSON.stringify(profile)) {
          throw new Error('Не удалось подтвердить актуальные права профиля. Повторите подключение.')
        }
        rememberPersonalContext({ session, profile: updated })
        setProfile(updated)
      }).catch((cause) => { if (active) { setError(accessError(cause)); setRetryable(true) } })
        .finally(() => { refreshing = false })
    }, (cause) => {
      if (!active) return
      if ((cause as { code?: string }).code === 'permission-denied') {
        setInvalidProfile(profile)
        void recoverPersonalContext(session).then((recovered) => {
          if (!active || recovered) return
          if (clearPersonalSession(session) === false) return
          setSession(null); setProfile(null); setInvalidProfile(null)
          setError(accessError(cause)); setRetryable(true)
        }).catch((failure) => { if (active) { setError(accessError(failure)); setRetryable(true) } })
        return
      }
      setError(accessError(cause))
      setRetryable(true)
    }))
    return () => { active = false; stops.forEach((stop) => stop()); diagnosticStops.forEach((stop) => stop()) }
  }, [session, profile, verifiedSession, retry])

  useEffect(() => {
    if (!session) return
    let active = true
    let refreshing = false
    const refreshIfDue = () => {
      const cached = readCachedPersonalContext()
      if (!active || refreshing || !cached || Date.now() - cached.savedAt < 30 * 60_000) return
      refreshing = true
      void loadPersonalProfile(session).then((updated) => {
        if (!active) return
        rememberPersonalContext({ session, profile: updated })
        setProfile((previous) => JSON.stringify(previous) === JSON.stringify(updated) ? previous : updated)
      }).catch((cause) => { if (active) setError(accessError(cause)) })
        .finally(() => { refreshing = false })
    }
    const timer = window.setInterval(refreshIfDue, 5 * 60_000)
    window.addEventListener('focus', refreshIfDue)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refreshIfDue) }
  }, [session])

  const openLink = async (value: string) => {
    initialLinkToRedeem.current = undefined
    pendingLink.current = value
    setBusy(true)
    setError('')
    setRetryable(false)
    try {
      const redeemed = await redeemPersonalLink(secretFromPastedPersonalLink(value))
      const loaded = await loadPersonalProfile(redeemed)
      rememberPersonalContext({ session: redeemed, profile: loaded })
      setProfile(loaded)
      setSession(redeemed)
      setContextAvailable(true)
      pendingLink.current = null
      automaticRetries.current = 0
      setLink('')
    } catch (cause) {
      setError(accessError(cause))
      const transient = transientAccessError(cause)
      setRetryable(transient)
      if (!transient) pendingLink.current = null
    } finally { setBusy(false) }
  }

  const retryConnection = () => {
    automaticRetries.current = 0
    if (pendingLink.current) void openLink(pendingLink.current)
    else setRetry((value) => value + 1)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    void openLink(link)
  }

  const showNativePaste = () => {
    setManualEntry(true)
    // Safari does not grant persistent clipboard-read permission. Its native
    // Paste action on an editable field is the reliable fallback on iPhone.
    window.setTimeout(() => manualInput.current?.focus(), 0)
  }

  const pasteLink = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text/plain')
    if (!pasted) return
    event.preventDefault()
    setLink(pasted)
    void openLink(pasted)
  }

  const openFromClipboard = async () => {
    setError('')
    setBusy(true)
    try {
      if (!navigator.clipboard?.readText) {
        showNativePaste()
        setError('iPhone не разрешил чтение буфера кнопкой. Нажмите «Вставить» в открывшемся поле — ссылка проверится сразу.')
        return
      }
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        setError('Буфер обмена пуст. Скопируйте личную ссылку профиля и нажмите кнопку ещё раз.')
        return
      }
      await openLink(text)
    } catch {
      showNativePaste()
      setError('iPhone не разрешил чтение буфера кнопкой. Нажмите «Вставить» в открывшемся поле — ссылка проверится сразу.')
    } finally { setBusy(false) }
  }

  const copyPersonalLink = async () => {
    if (!session) return
    try {
      await navigator.clipboard.writeText(personalEntryUrl(session))
      setCopied(true)
      setError('')
    } catch {
      setError('Не удалось скопировать ссылку. Откройте исходную личную ссылку и скопируйте её вручную.')
    }
  }

  if (profile && invalidProfile === profile || session && invalidSession === session) return error ? <p role="alert" className="personal-login-error">{error}</p> : null

  if (profile) {
    const parent = profile.children.some((child) => child.role === 'parent')
    const available = profile.children.filter((child) => child.role === 'student' && child.dashboardToken)
    const child = available.find((item) => `${item.familyId}/${item.childId}` === selectedChild) ?? available[0]
    return <div className="personal-entry">
      {earlyTarget ? (() => { const earlyChild = profile.children.find((item) => item.familyId === earlyTarget.familyId && item.childId === earlyTarget.childId && item.role === 'parent' && item.learningMode === 'early-development'); return earlyChild && verifiedSession === session ? <EarlyDevelopmentPage key={`${earlyChild.familyId}/${earlyChild.childId}`} child={earlyChild} /> : <p role="status">{verifiedSession === session ? 'Раздел доступен родителю подключённого ребёнка. Вернитесь в свой профиль.' : 'Подтверждаем доступ родителя…'}</p> })() : parent ? <ParentHome profile={profile} /> : <>
        {available.length > 1 && <nav className="personal-child-picker" aria-label="Выбрать ребёнка">{available.map((item) => <Button key={`${item.familyId}/${item.childId}`} type="button" variant={item === child ? 'default' : 'outline'} onClick={() => setSelectedChild(`${item.familyId}/${item.childId}`)}>{item.displayName}</Button>)}</nav>}
        {child?.dashboardToken ? <DayDashboard key={child.dashboardToken} token={child.dashboardToken} parent={false} />
          : <Card><CardContent className="py-8">Dashboard для этого профиля ещё не опубликован.</CardContent></Card>}
      </>}
      <details className="personal-install-hint"><summary>Личная ссылка для установки на iPhone</summary>
        <p>Скопируйте именно ссылку профиля перед добавлением сайта на экран «Домой». При первом запуске с иконки нажмите «Войти по ссылке из буфера».</p>
        <Button type="button" variant="outline" onClick={() => void copyPersonalLink()}>{copied ? <Check /> : <Copy />}{copied ? 'Ссылка скопирована' : 'Скопировать личную ссылку'}</Button>
      </details>
      {error && <p role="alert" className="personal-login-error">{error}</p>}
      {retryable && <Button type="button" variant="outline" disabled={busy} onClick={retryConnection}>Повторить подключение</Button>}
    </div>
  }

  if (busy && !error) return null

  return <Card className="personal-login mx-auto max-w-2xl">
    <CardHeader>
      <div className="personal-entry-icon"><KeyRound /></div>
      <CardTitle>Войти в Education</CardTitle>
      <CardDescription>Скопируйте личную ссылку профиля и нажмите кнопку. Это нужно один раз после установки приложения на телефон.</CardDescription>
    </CardHeader>
    <CardContent>
      <Button type="button" className="personal-clipboard-button" disabled={busy} onClick={() => void openFromClipboard()}><ClipboardPaste />{busy ? 'Открываем…' : 'Войти по ссылке из буфера'}</Button>
      <button type="button" className="personal-manual-toggle" onClick={() => { if (manualEntry) setManualEntry(false); else showNativePaste() }} aria-expanded={manualEntry}>{manualEntry ? 'Скрыть ручной ввод' : 'Вставить вручную'}</button>
      {manualEntry && <form onSubmit={submit} className="personal-login-form">
        <Input ref={manualInput} aria-label="Личная ссылка Education" autoComplete="off" placeholder="https://…/#/enter/…" value={link} onPaste={pasteLink} onChange={(event) => { setLink(event.target.value); setError('') }} />
        <Button type="submit" disabled={busy || !link.trim()}>{busy ? 'Открываем…' : 'Войти'}</Button>
      </form>}
      {busy && !link && <p className="text-muted-foreground">Проверяем доступ…</p>}
      {!online && <p role="status" className="personal-offline">Нет сети. Приложение открылось, но личный план загрузится после подключения.</p>}
      {error && <p role="alert" className="personal-login-error">{error}</p>}
      {retryable && <Button type="button" variant="outline" disabled={busy} onClick={retryConnection}>Повторить подключение</Button>}
    </CardContent>
  </Card>
}
