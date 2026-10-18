/** Temporary operator-enabled projection measurements; never changes authority.
 * @see ../../docs/modules/families/access-and-state.md#access-diagnostics
 * @see ../../docs/decisions/role-projection-diagnostics-2026-10-18.md */
import { getAuth } from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { PersonalSession } from './personalAccess'
import { traceAccessContext } from './browserAccessTrace'

type Scope = { session: PersonalSession; role: string; profileRole: string; children: string[]; until?: { toMillis: () => number }; signatures: Set<string>; observed: Map<string, { parent: boolean; hasGuide: boolean }> }
type DiagnosticMember = { active?: boolean; role?: string; childIds?: string[]; accessDiagnosticsUntil?: { toMillis?: () => number } }
const scopes = new Map<string, Scope>()
export function configureRoleDiagnostics(session: PersonalSession, familyId: string, member: DiagnosticMember, profileRole: string) {
  for (const childId of Array.isArray(member.childIds) ? member.childIds.filter((id) => typeof id === 'string') : []) traceAccessContext('access.resolved', { atFunction: 'configureRoleDiagnostics', previousState: 'checking', state: member.role === profileRole ? 'resolved' : 'changed', source: 'member-server', fromCache: false, role: member.role, active: member.active, previousRole: profileRole,
    reason: member.role === profileRole ? 'member-valid' : 'role-mismatch' }, { ...session, familyId, childId })
  const until = member.accessDiagnosticsUntil
  if (!member.active || !member.role || !['parent', 'student'].includes(member.role) || !Array.isArray(member.childIds)) return () => {}
  const previous = scopes.get(familyId)
  const same = previous?.session.personId === session.personId && previous.session.deviceUid === session.deviceUid
    && previous.session.linkToken === session.linkToken && previous.role === member.role
  const expiry = typeof until?.toMillis === 'function' ? until as Scope['until'] : undefined
  const scope: Scope = { session, role: member.role, profileRole, children: member.childIds, until: expiry,
    signatures: same && previous.until?.toMillis() === expiry?.toMillis() ? previous.signatures : new Set(),
    observed: same ? previous.observed : new Map() }
  scopes.set(familyId, scope)
  // Turning on the window measures an already mounted card without a new click.
  for (const [childId, observed] of scope.observed) reportRoleProjection({ familyId, childId }, observed.parent, observed.hasGuide)
  return () => { if (scopes.get(familyId) === scope) scopes.delete(familyId) }
}

export function reportRoleProjection(owner: { familyId?: string; childId?: string } | undefined, parent: boolean, hasGuide: boolean) {
  traceAccessContext('view.rendered', { atFunction: 'reportRoleProjection', previousState: 'selected', state: 'rendered', source: 'card', role: parent ? 'parent' : 'student', hasGuide, route: location.hash.split('/')[1] || 'home', reason: 'role-projection' }, owner ?? {})
  if (!owner?.familyId || !owner.childId) return
  const scope = scopes.get(owner.familyId)
  if (!scope || !scope.children.includes(owner.childId)
    || getAuth().currentUser?.uid !== scope.session.deviceUid) return
  scope.observed.set(owner.childId, { parent, hasGuide })
  if (!scope.until || scope.until.toMillis() <= Date.now()) return
  const route = location.hash.split('/')[1]
  const surface = ['day', 'day-parent', 'days', 'days-parent'].includes(route) ? route : 'home'
  const signature = `${owner.childId}:${parent}:${hasGuide}:${surface}`
  if (scope.signatures.has(signature)) return
  scope.signatures.add(signature)
  void setDoc(doc(db, 'clientRoleDiagnostics', scope.session.deviceUid), {
    schemaVersion: 1, probeVersion: 'role-projection-v1', personId: scope.session.personId,
    familyId: owner.familyId, childId: owner.childId, memberRole: scope.role, profileRole: scope.profileRole,
    renderedRole: parent ? 'parent' : 'student', hasGuide, surface,
    sampledAt: serverTimestamp(), expiresAt: scope.until,
  }).catch(() => { scope.signatures.delete(signature) })
}
