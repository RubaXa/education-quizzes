
/**
 * @see ../../docs/modules/families/early-development.md
 * @see ../../docs/decisions/local-first-role-recovery-2026-10-18.md
 * @see ../../docs/shared/access-and-privacy.md
 * @see ../../docs/decisions/personal-identity-transition-2026-10-18.md
 */
import { getAuth, signInAnonymously } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { createRequestSingleFlight } from './requestSingleFlight'
import { clearCachedLessonStatuses } from './dayDashboardLessonCache'
import { clearCachedDashboardView } from './dayDashboardViewCache'
import { clearCachedInbox } from './inboxCache'
import { accessTraceError, traceAccess, traceAccessContext, traceProfile } from './browserAccessTrace'

/** @see ../../docs/modules/families/README.md#link-login */
export type PersonalSession = { personId: string; deviceUid: string; linkToken: string }
export type PersonalChild = {
  familyId: string
  childId: string
  displayName: string
  role: 'parent' | 'student'
  learningMode?: 'school' | 'early-development'
  dashboardToken?: string
  dayToken?: string
  dashboardTokens?: { student?: string; parent?: string }
  dayTokens?: { student?: string; parent?: string }
}
export type PersonalProfile = {
  personId: string
  displayName: string
  children: PersonalChild[]
}

let activeSession: PersonalSession | null = null
let sessionRevision = 0
let pendingRedemption: { linkToken: string; promise: Promise<PersonalSession> } | null = null
let pendingRecovery: { session: PersonalSession; promise: Promise<boolean> } | null = null
const startupContext = createRequestSingleFlight<string, { session: PersonalSession; profile: PersonalProfile } | null>(3_000)
const secretPattern = /^[A-Za-z0-9_-]{43}$/
const localContextKey = 'education-personal-context-v1'
const lastDashboardRouteKey = 'education-last-dashboard-route-v1'
const localContextMaxAgeMs = 30 * 60_000
type PersonalContext = { session: PersonalSession; profile: PersonalProfile }
type CachedPersonalContext = PersonalContext & { savedAt: number }
const contextObservers = new Set<() => void>()
const sameSession = (left: PersonalSession, right: PersonalSession) => left.personId === right.personId && left.deviceUid === right.deviceUid && left.linkToken === right.linkToken
function changedInAnotherTab(event: StorageEvent) {
  if (event.key !== null && event.key !== localContextKey) return
  // localStorage is shared, but module memory and mounted routes are not.
  // Invalidate pending old reads before notifying the visible consumers.
  sessionRevision++
  activeSession = null
  startupContext.clear()
  traceAccess('identity.changed', { atFunction: 'changedInAnotherTab', previousState: 'resolved', state: 'changed', source: 'storage', reason: 'context-changed' })
  contextObservers.forEach((changed) => changed())
}

/** Reconcile an open tab with an already saved login/logout in a sibling tab.
 * No remote request, promotion of role, or new authorization is performed here.
 * @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes
 */
export function watchPersonalContextChanges(changed: () => void): () => void {
  if (!contextObservers.size) window.addEventListener('storage', changedInAnotherTab)
  contextObservers.add(changed)
  return () => {
    contextObservers.delete(changed)
    if (!contextObservers.size) window.removeEventListener('storage', changedInAnotherTab)
  }
}

/** A device-scoped last known view. Firestore rules remain the authority for every remote read/write.
 * @see ../../docs/plans/local-first-release-plan-2026-10-12.md#personal-startup
 */
export function readCachedPersonalContext(): CachedPersonalContext | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(localContextKey) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const cached = value as Partial<CachedPersonalContext>
    const session = cached.session
    const profile = cached.profile
    if (!session || !profile || !secretPattern.test(session.linkToken) ||
      typeof session.deviceUid !== 'string' || !session.deviceUid ||
      typeof session.personId !== 'string' || profile.personId !== session.personId ||
      typeof profile.displayName !== 'string' || !Array.isArray(profile.children) ||
      !profile.children.every((child) => typeof child.familyId === 'string' && typeof child.childId === 'string' &&
        typeof child.displayName === 'string' && (child.role === 'parent' || child.role === 'student')) ||
      !Number.isFinite(cached.savedAt) || cached.savedAt! > Date.now() + 60_000) return null
    return cached as CachedPersonalContext
  } catch { return null }
}

export function rememberPersonalContext(context: PersonalContext): void {
  const saved = readCachedPersonalContext()?.session
  if (context.profile.personId !== context.session.personId
    || pendingRedemption && pendingRedemption.linkToken !== context.session.linkToken
    || saved && (saved.personId !== context.session.personId || saved.deviceUid !== context.session.deviceUid || saved.linkToken !== context.session.linkToken)
    || activeSession && (activeSession.personId !== context.session.personId
      || activeSession.deviceUid !== context.session.deviceUid || activeSession.linkToken !== context.session.linkToken)) {
    throw new Error('Личная сессия изменилась. Повторите вход.')
  }
  activeSession = context.session
  traceProfile(context.profile, context.session.deviceUid, 'profile', 'rememberPersonalContext')
  try { localStorage.setItem(localContextKey, JSON.stringify({ ...context, savedAt: Date.now() })) }
  catch { /* The current session still works without durable storage. */ }
}

function forgetCachedPersonalContext(): void {
  try { localStorage.removeItem(localContextKey) } catch { /* Ignore blocked storage. */ }
}

function forgetPersonalViews(): void {
  const cached = readCachedPersonalContext()
  if (!cached) return
  clearCachedInbox(cached.profile.personId)
  try {
    const familyChildren = new Map<string, string[]>()
    for (const child of cached.profile.children) {
      familyChildren.set(child.familyId, [...(familyChildren.get(child.familyId) ?? []), child.childId])
      if (!child.dashboardToken) continue
      localStorage.removeItem(`education-day-dashboard-v1:${child.dashboardToken}`)
      localStorage.removeItem(`education-parent-overview-v1:${cached.profile.personId}:${child.dashboardToken}`)
      clearCachedLessonStatuses(child.dashboardToken, child.role)
      clearCachedDashboardView(child.role, child.dashboardToken)
    }
    for (const [familyId, childIds] of familyChildren) localStorage.removeItem(`education-family-library-v1:${familyId}:${childIds.sort().join(',')}`)
    localStorage.removeItem('education-dashboard-selected-date')
    localStorage.removeItem('education-dashboard-selection-day')
  } catch { /* Local storage may be unavailable. */ }
}

export function readLastPersonalDashboardRoute(): string | null {
  const cached = readCachedPersonalContext()
  if (!cached) return null
  const knownUid = getAuth().currentUser?.uid
  if (knownUid && knownUid !== cached.session.deviceUid) return null
  try {
    const route = localStorage.getItem(lastDashboardRouteKey)
    const match = route?.match(/^#\/(days|days-parent)\/([A-Za-z0-9_-]+)$/)
    if (!match) return null
    const child = cached.profile.children.find((child) => child.dashboardToken === match[2] || Object.values(child.dashboardTokens ?? {}).includes(match[2]))
    return child ? `#/days/${child.dashboardTokens?.student ?? match[2]}` : null
  } catch { return null }
}

export function rememberPersonalDashboardRoute(route: string): void {
  try {
    if (route === '#/' || route === '') localStorage.removeItem(lastDashboardRouteKey)
    else if (/^#\/(days|days-parent)\/[A-Za-z0-9_-]+$/.test(route)) localStorage.setItem(lastDashboardRouteKey, route)
  } catch { /* The open route still works. */ }
}

export function currentEducationPersonId(): string {
  const saved = readCachedPersonalContext()?.session
  if (!activeSession || getAuth().currentUser?.uid !== activeSession.deviceUid
    || saved && (saved.personId !== activeSession.personId || saved.deviceUid !== activeSession.deviceUid || saved.linkToken !== activeSession.linkToken)) {
    throw new Error('Откройте личную ссылку Education.')
  }
  return activeSession.personId
}

/** Revoke only the session owned by a callback. A sibling can save its replacement
 * before the storage event reaches this tab; the old callback must not erase it.
 * @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes */
export function clearPersonalSession(expected?: PersonalSession): boolean {
  const saved = readCachedPersonalContext()?.session
  if (expected && saved && (saved.personId !== expected.personId || saved.deviceUid !== expected.deviceUid || saved.linkToken !== expected.linkToken)) {
    sessionRevision++
    activeSession = null
    startupContext.clear()
    traceAccess('identity.changed', { atFunction: 'clearPersonalSession', previousState: 'checking', state: 'changed', source: 'storage', reason: 'stale-revocation-ignored' })
    contextObservers.forEach((changed) => changed())
    return false
  }
  traceAccess('identity.changed', { atFunction: 'clearPersonalSession', previousState: 'resolved', state: 'cleared', source: 'memory', reason: 'context-cleared' })
  sessionRevision++
  activeSession = null
  startupContext.clear()
  forgetPersonalViews()
  forgetCachedPersonalContext()
  rememberPersonalDashboardRoute('#/')
  return true
}

/** Recover an already authorized replacement binding; never redeem a link or write rights.
 * Local-first remains the normal path. This addressed read runs only after a confirmed
 * device/grant/member mismatch, including permission-denied arriving before the device listener.
 * @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes */
export async function recoverPersonalContext(expected: PersonalSession): Promise<boolean> {
  const saved = readCachedPersonalContext()?.session
  if (saved && !sameSession(saved, expected)) {
    clearPersonalSession(expected) // Invalidate the old memory, preserve and announce the newer login.
    return true
  }
  if (pendingRedemption) { await pendingRedemption.promise; return true }
  if (pendingRecovery && sameSession(pendingRecovery.session, expected)) return pendingRecovery.promise
  const revision = sessionRevision
  const promise = (async () => {
    const auth = getAuth()
    await auth.authStateReady()
    if (auth.currentUser?.uid !== expected.deviceUid) return false
    const device = await getDoc(doc(db, 'deviceSessions', expected.deviceUid))
    if (revision !== sessionRevision || pendingRedemption) return true
    // A cached binding is not evidence of a remote replacement or revocation.
    if (device.metadata?.fromCache) throw Object.assign(new Error('Не удалось сверить текущий вход устройства.'), { code: 'unavailable' })
    const linkToken = device.data()?.linkToken
    if (!device.exists() || typeof linkToken !== 'string' || !secretPattern.test(linkToken) || linkToken === expected.linkToken) return false
    traceAccess('identity.changed', { atFunction: 'recoverPersonalContext', previousState: 'checking', state: 'changed', source: 'device-server', reason: 'device-binding-changed' })
    const grant = await getDoc(doc(db, 'accessLinks', linkToken))
    if (revision !== sessionRevision || pendingRedemption) return true
    if (grant.metadata?.fromCache) throw Object.assign(new Error('Не удалось подтвердить действующий вход.'), { code: 'unavailable' })
    const personId = grant.data()?.personId
    if (!grant.exists() || grant.data()?.active !== true || typeof personId !== 'string') return false
    const session = { deviceUid: expected.deviceUid, linkToken, personId }
    const profile = await loadPersonalProfile(session)
    if (revision !== sessionRevision || pendingRedemption || auth.currentUser?.uid !== expected.deviceUid) return true
    const current = readCachedPersonalContext()?.session
    if (current && !sameSession(current, expected)) { clearPersonalSession(expected); return true }
    sessionRevision++
    startupContext.clear()
    forgetPersonalViews()
    forgetCachedPersonalContext()
    activeSession = null
    rememberPersonalContext({ session, profile })
    traceAccessContext('identity.resolved', { atFunction: 'recoverPersonalContext', previousState: 'changed', state: 'resolved', source: 'device-server', reason: 'device-binding-recovered' }, session)
    contextObservers.forEach((changed) => changed())
    return true
  })().catch((cause: unknown) => {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'permission-denied') return false
    throw cause
  })
  pendingRecovery = { session: expected, promise }
  try { return await promise }
  finally { if (pendingRecovery?.promise === promise) pendingRecovery = null }
}

export function secretFromPersonalLink(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Ссылка не найдена. Скопируйте личную ссылку родителя или ребёнка и попробуйте снова.')
  if (secretPattern.test(trimmed)) return trimmed
  let hash = trimmed
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed)
    const allowedOrigin = url.origin === 'https://rubaxa.github.io' || url.origin === location.origin
    if (!allowedOrigin || !/^\/education-quizzes\/?$/.test(url.pathname)) {
      throw new Error('Это ссылка на другой сайт. Нужна личная ссылка Education.')
    }
    hash = url.hash
  }
  const secret = hash.match(/^#\/enter\/([A-Za-z0-9_-]{43})$/)?.[1]
  if (secret) return secret
  if (/^#\/(day|day-parent|days|days-parent)\//.test(hash)) {
    throw new Error('Это ссылка на учебный день, а для входа в приложение нужна личная ссылка профиля. Откройте личную ссылку родителя или ребёнка.')
  }
  if (/^#\/(t|preview|dashboard|my|review)\//.test(hash)) {
    throw new Error('Это ссылка на тест или список заданий. Для входа в приложение нужна личная ссылка профиля.')
  }
  throw new Error('В ссылке нет личного входа Education. Она должна содержать #/enter/ после адреса сайта.')
}

/** A pasted value must be the complete personal URL, not an ambiguous bare token. */
export function secretFromPastedPersonalLink(value: string): string {
  const trimmed = value.trim()
  if (secretPattern.test(trimmed)) throw new Error('В буфере только код ссылки. Скопируйте личную ссылку Education целиком.')
  if (trimmed && !/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('#/')) {
    throw new Error('В буфере нет ссылки Education. Скопируйте личную ссылку профиля целиком.')
  }
  return secretFromPersonalLink(trimmed)
}

async function authUid(): Promise<string> {
  const auth = getAuth()
  await auth.authStateReady()
  if (auth.currentUser) return auth.currentUser.uid
  return (await signInAnonymously(auth)).user.uid
}

async function sessionFromGrant(linkToken: string, deviceUid: string, expectedRevision = sessionRevision): Promise<PersonalSession> {
  traceAccessContext('identity.resolved', { atFunction: 'sessionFromGrant', previousState: 'idle', state: 'checking', source: 'grant-server' }, { deviceUid, linkToken })
  const grant = await getDoc(doc(db, 'accessLinks', linkToken))
  if (expectedRevision !== sessionRevision) throw new Error('Личная сессия изменилась. Повторите вход.')
  const personId = grant.data()?.personId
  if (!grant.exists() || grant.data()?.active !== true || typeof personId !== 'string') {
    throw new Error('Личная ссылка закрыта. Попросите новую ссылку.')
  }
  activeSession = { personId, deviceUid, linkToken }
  traceAccessContext('identity.resolved', { atFunction: 'sessionFromGrant', previousState: 'checking', state: 'resolved', source: 'grant-server', reason: 'grant-valid' }, activeSession)
  return activeSession
}

/** @see ../../docs/product/pwa.md#install */
export function personalEntryUrl(session: PersonalSession): string {
  return `${location.origin}${import.meta.env.BASE_URL}#/enter/${session.linkToken}`
}

/** A link is a bearer credential. Its grant is checked again by Firestore rules on every read. */
export async function redeemPersonalLink(value: string): Promise<PersonalSession> {
  traceAccess('identity.changed', { atFunction: 'redeemPersonalLink', previousState: 'idle', state: 'redeeming', source: 'entry', reason: 'redemption-start' })
  const linkToken = secretFromPersonalLink(value)
  if (pendingRedemption?.linkToken === linkToken) return pendingRedemption.promise
  sessionRevision++
  startupContext.clear()
  forgetPersonalViews()
  forgetCachedPersonalContext()
  rememberPersonalDashboardRoute('#/')
  // A concurrent restore must not resurrect the former person while the
  // replacement grant is being checked on this same Firebase UID.
  activeSession = null
  const expectedRevision = sessionRevision
  const promise = (async () => {
    const deviceUid = await authUid()
    const reference = doc(db, 'deviceSessions', deviceUid)
    const previous = await getDoc(reference)
    await setDoc(reference, {
      linkToken,
      createdAt: previous.exists() ? previous.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return sessionFromGrant(linkToken, deviceUid, expectedRevision)
  })()
  pendingRedemption = { linkToken, promise }
  try {
    const session = await promise
    traceAccessContext('identity.resolved', { atFunction: 'redeemPersonalLink', previousState: 'redeeming', state: 'resolved', source: 'grant-server', reason: 'grant-valid' }, session)
    return session
  } catch (cause) {
    traceAccess('access.failed', { atFunction: 'redeemPersonalLink', previousState: 'redeeming', state: 'failed', source: 'entry', code: accessTraceError(cause) })
    throw cause
  }
  finally { if (pendingRedemption?.promise === promise) pendingRedemption = null }
}

/** Shared startup read for the entry screen and bell. Authorization is still
 * checked by Firestore on every document; revocation clears this short cache.
 * @see ../../docs/plans/local-first-release-plan-2026-10-12.md
 */
export async function restorePersonalContext(): Promise<{ session: PersonalSession; profile: PersonalProfile } | null> {
  traceAccess('identity.resolved', { atFunction: 'restorePersonalContext', previousState: 'idle', state: 'restoring', source: 'memory', reason: 'restore-start', role: 'pending' })
  const auth = getAuth()
  await auth.authStateReady()
  // Entry, calendar and inbox may restore simultaneously during link login.
  // Join that identity transition before consulting either memory or disk.
  if (pendingRedemption) await pendingRedemption.promise
  const uid = auth.currentUser?.uid
  if (!uid) { traceAccess('identity.resolved', { atFunction: 'restorePersonalContext', previousState: 'restoring', state: 'empty', source: 'memory', role: 'none', reason: 'cache-miss' }); return null }
  const cached = readCachedPersonalContext()
  if (cached && cached.session.deviceUid !== uid) { traceAccess('identity.resolved', { atFunction: 'restorePersonalContext', previousState: 'restoring', state: 'changed', source: 'local', reason: 'uid-mismatch' }); clearPersonalSession() }
  else if (cached && Date.now() - cached.savedAt < localContextMaxAgeMs) {
    activeSession = cached.session
    traceProfile(cached.profile, cached.session.deviceUid, 'local', 'restorePersonalContext')
    return { session: cached.session, profile: cached.profile }
  }
  return startupContext.get(uid, async () => {
    const expectedRevision = sessionRevision
    const session = await restorePersonalSession()
    if (!session) return null
    try {
      const profile = await loadPersonalProfile(session)
      if (expectedRevision !== sessionRevision) return null
      rememberPersonalContext({ session, profile })
      return { session, profile }
    } catch (cause) {
      traceAccess('access.failed', { atFunction: 'restorePersonalContext', previousState: 'loading', state: 'failed', source: 'profile', code: accessTraceError(cause) })
      // An expired browser cache can reference the previous person. Its profile
      // is denied before LearningRoute has mounted any access listener.
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'permission-denied'
        && await recoverPersonalContext(session)) {
        const replacement = readCachedPersonalContext()
        return replacement?.session.deviceUid === uid ? replacement : null
      }
      throw cause
    }
  })
}

/** @see ../../docs/modules/families/README.md#authorization */
export async function restorePersonalSession(): Promise<PersonalSession | null> {
  traceAccess('identity.resolved', { atFunction: 'restorePersonalSession', previousState: 'idle', state: 'restoring', source: 'memory', reason: 'restore-start' })
  const auth = getAuth()
  await auth.authStateReady()
  if (pendingRedemption) await pendingRedemption.promise
  const deviceUid = auth.currentUser?.uid
  if (!deviceUid) return null
  const cached = readCachedPersonalContext()
  if (cached?.session.deviceUid === deviceUid) {
    activeSession = cached.session
    traceAccessContext('identity.resolved', { atFunction: 'restorePersonalSession', previousState: 'restoring', state: 'cached', source: 'local', reason: 'cache-hit' }, activeSession)
    return activeSession
  }
  if (activeSession?.deviceUid === deviceUid) return activeSession
  const expectedRevision = sessionRevision
  const snapshot = await getDoc(doc(db, 'deviceSessions', deviceUid))
  if (expectedRevision !== sessionRevision) return null
  const linkToken = snapshot.data()?.linkToken
  if (!snapshot.exists() || typeof linkToken !== 'string' || !secretPattern.test(linkToken)) return null
  return sessionFromGrant(linkToken, deviceUid, expectedRevision)
}

/** @see ../../docs/modules/reviews/adaptive-problem-card.md#показ-ученику */
export async function dayHelpSessionRole(owner?: { familyId?: string; childId?: string }): Promise<'student' | 'parent' | null> {
  try {
    const context = await restorePersonalContext()
    if (!context) return null
    const children = owner ? context.profile.children.filter((child) => child.familyId === owner.familyId && child.childId === owner.childId) : context.profile.children
    const roles = [...new Set(children.map((child) => child.role))]
    return roles.length === 1 ? roles[0] : null
  } catch { return null }
}

/** @see ../../docs/modules/families/README.md#collections */
export async function loadPersonalProfile(session: PersonalSession): Promise<PersonalProfile> {
  traceAccessContext('identity.resolved', { atFunction: 'loadPersonalProfile', previousState: 'idle', state: 'loading', source: 'profile' }, session)
  try {
    const person = await getDoc(doc(db, 'users', session.personId))
    if (!person.exists()) throw new Error('Профиль ещё не опубликован.')
    const displayName = person.data().displayName
    if (typeof displayName !== 'string') throw new Error('У профиля нет имени.')
    const families = await getDocs(collection(db, 'users', session.personId, 'families'))
    const children: PersonalChild[] = []
    for (const family of families.docs) {
      const familyId = family.id
      const member = await getDoc(doc(db, 'families', familyId, 'members', session.personId))
      const role = member.data()?.role
      const childIds = Array.isArray(member.data()?.childIds) ? [...new Set([...member.data()!.childIds, ...(role === 'parent' && Array.isArray(member.data()?.earlyChildIds) ? member.data()!.earlyChildIds : [])])] : undefined
      traceAccessContext('access.resolved', { atFunction: 'loadPersonalProfile', previousState: 'loading', state: 'resolved', source: member.metadata?.fromCache === false ? 'member-server' : 'member-cache', fromCache: member.metadata?.fromCache, role, active: member.data()?.active === true,
        count: Array.isArray(childIds) ? childIds.length : 0, reason: member.exists() && member.data()?.active === true ? 'member-valid' : 'member-invalid' }, { ...session, familyId })
      if (!member.exists() || member.data()?.active !== true ||
        (role !== 'parent' && role !== 'student') || !Array.isArray(childIds)) continue
      for (const childId of childIds) {
        if (typeof childId !== 'string') continue
        const [child, shortcut] = await Promise.all([
          getDoc(doc(db, 'families', familyId, 'children', childId)),
          getDoc(doc(db, 'users', session.personId, 'families', familyId, 'shortcuts', childId)),
        ])
        if (!child.exists() || child.data().active === false) continue
        if (child.data().learningMode === 'early-development' && (role !== 'parent' || !member.data()?.earlyChildIds?.includes(childId))) continue
        const shortcutData = child.data().learningMode === 'early-development' ? {} : shortcut.data()
        children.push({
          familyId, childId, role,
          ...(child.data().learningMode === 'early-development' ? { learningMode: 'early-development' as const } : {}),
          displayName: typeof child.data().displayName === 'string' ? child.data().displayName : 'Ученик',
          dashboardToken: typeof shortcutData?.dashboardToken === 'string' ? shortcutData?.dashboardToken : undefined,
          dayToken: typeof shortcutData?.dayToken === 'string' ? shortcutData?.dayToken : undefined,
          ...(shortcutData?.dashboardTokens ? { dashboardTokens: shortcutData?.dashboardTokens } : {}),
          ...(shortcutData?.dayTokens ? { dayTokens: shortcutData?.dayTokens } : {}),
        })
      }
    }
    const profile = { personId: session.personId, displayName, children }
    traceProfile(profile, session.deviceUid, 'profile', 'loadPersonalProfile')
    return profile
  } catch (cause) {
    traceAccess('access.failed', { atFunction: 'loadPersonalProfile', previousState: 'loading', state: 'failed', source: 'profile', code: accessTraceError(cause) })
    throw cause
  }
}
