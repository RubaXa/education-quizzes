import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'

/** Time-bounded diagnostics for one known participant; no access or study mutation.
 * @see ../../docs/modules/families/access-and-state.md#access-diagnostics
 * @see ../../docs/decisions/role-projection-diagnostics-2026-10-18.md */
export async function roleDiagnostics(db, registry, personId, action, minutes = 30) {
  const person = registry.people?.[personId]
  if (!person?.familyId || !['parent', 'student'].includes(person.role)) throw new Error('Участник не найден в реестре.')
  const ref = db.doc(`families/${person.familyId}/members/${personId}`)
  const member = await ref.get()
  if (!member.exists || member.data()?.active !== true || member.data()?.role !== person.role) throw new Error('Членство не подтверждено.')
  if (action === 'start' || action === 'stop') {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new Error('Диагностическое окно: от1до60минут.')
    const until = Timestamp.fromMillis(Date.now() + (action === 'start' ? minutes * 60_000 : 0))
    await ref.update({ accessDiagnosticsUntil: until })
    const saved = await ref.get()
    if (saved.data()?.accessDiagnosticsUntil?.toMillis() !== until.toMillis()) throw new Error('Диагностическое окно не подтверждено.')
    return { action, role: person.role, until: until.toDate().toISOString(), verified: true }
  }
  if (action !== 'read') throw new Error('Ожидается start,stop,read.')
  const snapshots = await db.collection('clientRoleDiagnostics').where('familyId', '==', person.familyId).where('personId', '==', personId).limit(20).get()
  const reports = snapshots.docs.map((item) => {
    const data = item.data()
    return { device: createHash('sha256').update(item.id).digest('hex').slice(0, 12),
      memberRole: data.memberRole, profileRole: data.profileRole, renderedRole: data.renderedRole,
      hasGuide: data.hasGuide, surface: data.surface, probeVersion: data.probeVersion,
      sampledAt: data.sampledAt?.toDate?.()?.toISOString() ?? null, expiresAt: data.expiresAt?.toDate?.()?.toISOString() ?? null,
      mismatch: data.renderedRole !== person.role || data.memberRole !== person.role }
  }).sort((a, b) => String(b.sampledAt).localeCompare(String(a.sampledAt)))
  return { action, role: person.role, diagnosticUntil: member.data()?.accessDiagnosticsUntil?.toDate?.()?.toISOString() ?? null, reports }
}
