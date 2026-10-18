/** @see ../../docs/decisions/local-first-role-recovery-2026-10-18.md
 * @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes */
import { doc, getDoc } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from './firebase'
import { loadPersonalProfile, readCachedPersonalContext, rememberPersonalContext, restorePersonalContext } from './personalAccess'
import type { PersonalChild, PersonalProfile, PersonalSession } from './personalAccess'

export type LearningMode = 'day' | 'days'
export class LearningAccessError extends Error {}
type ViewTokens = { student?: string; parent?: string }
export type LearningTarget = { token: string; canonicalToken: string; child: PersonalChild; parent: boolean }
export type LearningAccess = LearningTarget & { session: PersonalSession }
export type LearningPageIdentity = { familyId?: string; childId?: string; viewTokens?: ViewTokens }

export function dashboardTarget(profile: PersonalProfile, token: string): LearningTarget | null {
  const matches = profile.children.filter((child) => child.dashboardToken === token
    || Object.values(child.dashboardTokens ?? {}).includes(token))
  if (matches.length !== 1) return null
  const child = matches[0]
  const actual = child.dashboardTokens?.[child.role] ?? child.dashboardToken
  const canonical = child.dashboardTokens?.student ?? (child.dashboardToken === token ? token : undefined)
  if (!actual || !canonical) return null
  return { token: actual, canonicalToken: canonical, child, parent: child.role === 'parent' }
}

export function dayTarget(profile: PersonalProfile, identity: LearningPageIdentity): LearningTarget {
  const matches = profile.children.filter((child) => child.familyId === identity.familyId && child.childId === identity.childId)
  if (matches.length !== 1) throw new LearningAccessError('Этот учебный день недоступен вашему профилю.')
  const child = matches[0]
  const actual = identity.viewTokens?.[child.role], canonical = identity.viewTokens?.student
  if (!actual || !canonical) throw new LearningAccessError('Связь учебного дня ещё не обновлена. Сообщите об этой странице.')
  return { token: actual, canonicalToken: canonical, child, parent: child.role === 'parent' }
}

export function learningHash(mode: LearningMode, token: string) { return `#/${mode}/${token}` }

/** The last saved role selects the first local frame, never a role encoded in a URL.
 * Unknown historic-day identities still need their one exact identity read.
 */
export function readCachedLearningAccess(mode: LearningMode, token: string): LearningAccess | undefined {
  const context = readCachedPersonalContext()
  const uid = getAuth().currentUser?.uid
  if (!context || uid && uid !== context.session.deviceUid) return
  if (mode === 'days') {
    const target = dashboardTarget(context.profile, token)
    return target ? { ...target, session: context.session } : undefined
  }
  const matches = context.profile.children.filter((child) => child.dayToken === token || Object.values(child.dayTokens ?? {}).includes(token))
  if (matches.length !== 1) return
  const child = matches[0]
  if (!child.dayTokens?.student || !child.dayTokens?.[child.role]) return
  return { ...dayTarget(context.profile, { familyId: child.familyId, childId: child.childId, viewTokens: child.dayTokens }), session: context.session }
}

/** Resolve aliases to the same resource, then use this child's membership, never a URL role. */
export async function loadLearningAccess(mode: LearningMode, token: string): Promise<LearningAccess> {
  let context = await restorePersonalContext()
  if (!context) throw new LearningAccessError('Откройте свою личную ссылку Education, чтобы войти.')
  let target: LearningTarget
  if (mode === 'days') {
    let match = dashboardTarget(context.profile, token)
    if (!match || !match.child.dashboardTokens?.student) {
      // One refresh upgrades a pre-migration cache. Do not try reading another role's index.
      const profile = await loadPersonalProfile(context.session)
      context = { session: context.session, profile }
      rememberPersonalContext(context)
      match = dashboardTarget(profile, token)
    }
    if (!match) throw new LearningAccessError('Этот календарь недоступен вашему профилю.')
    target = match
  } else {
    // One exact historic-day identity read; no collection scans or private guide reads here.
    const snapshot = await getDoc(doc(db, 'dayPages', token))
    if (!snapshot.exists()) throw new LearningAccessError('Учебный день не найден.')
    target = dayTarget(context.profile, snapshot.data() as LearningPageIdentity)
  }
  return { ...target, session: context.session }
}
