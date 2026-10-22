/** @see ../../docs/modules/families/early-development.md */
import { Timestamp } from 'firebase-admin/firestore'
import { program } from '../../early-development/program.mjs'
import { inheritFamilyBooks } from '../../storage/family-book-inheritance.mjs'

/** Reuse the canonical child; keep school credentials inactive. No student identity is created. */
export async function enableEarlyDevelopment(db, registry, { familyId, childId, birthDate, parentIds }) {
  if (!registry.families[familyId]?.childIds.includes(childId)) throw new Error('Ребёнок не принадлежит этой семье.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate ?? '') || !Number.isFinite(Date.parse(birthDate))
    || new Date(birthDate).toISOString().slice(0, 10) !== birthDate || birthDate > new Date().toISOString().slice(0, 10)) throw new Error('Нужна подтверждённая дата рождения YYYY-MM-DD.')
  if (!Array.isArray(parentIds) || !parentIds.length || new Set(parentIds).size !== parentIds.length
    || parentIds.some((id) => registry.people[id]?.familyId !== familyId || registry.people[id]?.role !== 'parent')) throw new Error('Нужны родительские профили этой семьи.')
  const base = `families/${familyId}/children/${childId}`
  const members = await db.collection(`families/${familyId}/members`).get()
  const studentIds = members.docs.filter((item) => item.data().role === 'student' && item.data().childIds?.includes(childId)).map((item) => item.id)
  const revokedIds = members.docs.filter((item) => studentIds.includes(item.id) && item.data().childIds.length === 1).map((item) => item.id)
  const links = await Promise.all(revokedIds.map((id) => db.collection('accessLinks').where('personId', '==', id).get()))
  await db.runTransaction(async (tx) => {
    const refs = [db.doc(base), db.doc(`${base}/earlyDevelopment/current`), ...parentIds.map((id) => db.doc(`families/${familyId}/members/${id}`)), ...studentIds.map((id) => db.doc(`families/${familyId}/members/${id}`))]
    const snapshots = await tx.getAll(...refs)
    const [child, previous, ...people] = snapshots
    if (!child.exists || child.data().meshPersonId) throw new Error('Ранний режим нельзя включить вместо подключённого школьного источника.')
    if (people.slice(0, parentIds.length).some((item) => item.data()?.active !== true || item.data()?.role !== 'parent')) throw new Error('Членство родителя не подтверждено.')
    const now = Timestamp.now()
    tx.update(child.ref, { learningMode: 'early-development', active: true, updatedAt: now })
    tx.set(previous.ref, { schemaVersion: 1, birthDate, timezone: 'Europe/Moscow', curriculum: program, programVersion: program.version, createdAt: previous.data()?.createdAt ?? now, updatedAt: now })
    for (const member of people.slice(0, parentIds.length)) tx.update(member.ref, { childIds: (member.data().childIds ?? []).filter((id) => id !== childId), earlyChildIds: [...new Set([...(member.data().earlyChildIds ?? []), childId])] })
    for (const member of people.slice(parentIds.length)) {
      const remaining = member.data().childIds.filter((id) => id !== childId)
      tx.update(member.ref, { childIds: remaining, active: remaining.length ? member.data().active : false })
    }
    for (const snapshot of links) for (const link of snapshot.docs) if (link.data().active === true) tx.update(link.ref, { active: false, revokedAt: now })
  })
  const books = await inheritFamilyBooks(db, familyId, { targetChildId: childId })
  const [child, plan, ...parents] = await Promise.all([db.doc(base).get(), db.doc(`${base}/earlyDevelopment/current`).get(), ...parentIds.map((id) => db.doc(`families/${familyId}/members/${id}`).get())])
  if (child.data()?.learningMode !== 'early-development' || child.data()?.active !== true || plan.data()?.programVersion !== program.version
    || plan.data()?.birthDate !== birthDate || parents.some((parent) => !parent.data()?.earlyChildIds.includes(childId) || parent.data()?.childIds.includes(childId))) throw new Error('Обратная проверка раннего режима не прошла.')
  return { learningMode: 'early-development', programVersion: program.version, parentCount: parents.length, booksShared: books.shared, verified: true }
}
