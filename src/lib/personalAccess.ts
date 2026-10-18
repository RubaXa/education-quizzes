
/**
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
import { traceAccess, traceAccessContext, traceProfile } from './browserAccessTrace'

/** @see ../../docs/modules/families/README.md#link-login */
export type PersonalSession = { personId: string; deviceUid: string; linkToken: string }
export type PersonalChild = {
  familyId: string
  childId: string
  displayName: string
  role: 'parent' | 'student'
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
const startupContext = createRequestSingleFlight<string, { session: PersonalSession; profile: PersonalProfile } | null>(3_000)
const secretPattern = /^[A-Za-z0-9_-]{43}$/
const localContextKey = 'education-personal-context-v1'
const lastDashboardRouteKey = 'education-last-dashboard-route-v1'
const localContextMaxAgeMs = 30 * 60_000
type PersonalContext = { session: PersonalSession; profile: PersonalProfile }
type CachedPersonalContext = PersonalContext & { savedAt: number }
const contextObservers = new Set<() => void>()
function changedInAnotherTab(event: StorageEvent) {
  if (event.key !== null && event.key !== localContextKey) return
  // localStorage is shared, but module memory and mounted routes are not.
  // Invalidate pending old reads before notifying the visible consumers.
  sessionRevision++
  activeSession = null
  startupContext.clear()
  traceAccess('identity.changed', { source: 'storage', reason: 'context-changed' })
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
  traceProfile(context.profile, context.session.deviceUid)
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

/** Forget a revoked personal grant without deleting the device's Firebase UID. */
export function clearPersonalSession(): void {
  traceAccess('identity.changed', { source: 'memory', reason: 'context-cleared' })
  sessionRevision++
  activeSession = null
  startupContext.clear()
  forgetPersonalViews()
  forgetCachedPersonalContext()
  rememberPersonalDashboardRoute('#/')
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
  const grant = await getDoc(doc(db, 'accessLinks', linkToken))
  if (expectedRevision !== sessionRevision) throw new Error('Личная сессия изменилась. Повторите вход.')
  const personId = grant.data()?.personId
  if (!grant.exists() || grant.data()?.active !== true || typeof personId !== 'string') {
    throw new Error('Личная ссылка закрыта. Попросите новую ссылку.')
  }
  activeSession = { personId, deviceUid, linkToken }
  traceAccessContext('identity.resolved', { source: 'grant-server', reason: 'grant-valid' }, activeSession)
  return activeSession
}

/** @see ../../docs/product/pwa.md#install */
export function personalEntryUrl(session: PersonalSession): string {
  return `${location.origin}${import.meta.env.BASE_URL}#/enter/${session.linkToken}`
}

/** A link is a bearer credential. Its grant is checked again by Firestore rules on every read. */
export async function redeemPersonalLink(value: string): Promise<PersonalSession> {
  traceAccess('identity.changed', { source: 'entry', reason: 'redemption-start' })
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
  try { return await promise }
  finally { if (pendingRedemption?.promise === promise) pendingRedemption = null }
}

/** Shared startup read for the entry screen and bell. Authorization is still
 * checked by Firestore on every document; revocation clears this short cache.
 * @see ../../docs/plans/local-first-release-plan-2026-10-12.md
 */
export async function restorePersonalContext(): Promise<{ session: PersonalSession; profile: PersonalProfile } | null> {
  traceAccess('identity.resolved', { source: 'memory', reason: 'restore-start', role: 'pending' })
  const auth = getAuth()
  await auth.authStateReady()
  // Entry, calendar and inbox may restore simultaneously during link login.
  // Join that identity transition before consulting either memory or disk.
  if (pendingRedemption) await pendingRedemption.promise
  const uid = auth.currentUser?.uid
  if (!uid) { traceAccess('identity.resolved', { source: 'memory', role: 'none', reason: 'cache-miss' }); return null }
  const cached = readCachedPersonalContext()
  if (cached && cached.session.deviceUid !== uid) { traceAccess('identity.resolved', { source: 'local', reason: 'uid-mismatch' }); clearPersonalSession() }
  else if (cached && Date.now() - cached.savedAt < localContextMaxAgeMs) {
    activeSession = cached.session
    traceProfile(cached.profile, cached.session.deviceUid, 'local')
    return { session: cached.session, profile: cached.profile }
  }
  return startupContext.get(uid, async () => {
    const expectedRevision = sessionRevision
    const session = await restorePersonalSession()
    if (!session) return null
    const profile = await loadPersonalProfile(session)
    if (expectedRevision !== sessionRevision) return null
    rememberPersonalContext({ session, profile })
    return { session, profile }
  })
}

/** @see ../../docs/modules/families/README.md#authorization */
export async function restorePersonalSession(): Promise<PersonalSession | null> {
  const auth = getAuth()
  await auth.authStateReady()
  if (pendingRedemption) await pendingRedemption.promise
  const deviceUid = auth.currentUser?.uid
  if (!deviceUid) return null
  const cached = readCachedPersonalContext()
  if (cached?.session.deviceUid === deviceUid) {
    activeSession = cached.session
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
    const childIds = member.data()?.childIds
    if (!member.exists() || member.data()?.active !== true ||
      (role !== 'parent' && role !== 'student') || !Array.isArray(childIds)) continue
    for (const childId of childIds) {
      if (typeof childId !== 'string') continue
      const [child, shortcut] = await Promise.all([
        getDoc(doc(db, 'families', familyId, 'children', childId)),
        getDoc(doc(db, 'users', session.personId, 'families', familyId, 'shortcuts', childId)),
      ])
      if (!child.exists()) continue
      children.push({
        familyId, childId, role,
        displayName: typeof child.data().displayName === 'string' ? child.data().displayName : 'Ученик',
        dashboardToken: typeof shortcut.data()?.dashboardToken === 'string' ? shortcut.data()?.dashboardToken : undefined,
        dayToken: typeof shortcut.data()?.dayToken === 'string' ? shortcut.data()?.dayToken : undefined,
        ...(shortcut.data()?.dashboardTokens ? { dashboardTokens: shortcut.data()?.dashboardTokens } : {}),
        ...(shortcut.data()?.dayTokens ? { dayTokens: shortcut.data()?.dayTokens } : {}),
      })
    }
  }
  return { personId: session.personId, displayName, children }
}
