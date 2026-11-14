/** @see ../../docs/modules/families/README.md#birthday */
import { Timestamp } from 'firebase-admin/firestore'

export async function setChildBirthday(db, registry, { familyId, childId, birthday }) {
  if (!registry.families[familyId]?.childIds?.includes(childId)) throw new Error('Ребёнок не принадлежит указанной семье.')
  const date = /^\d{2}-\d{2}$/.test(birthday ?? '') ? new Date(`2000-${birthday}T12:00:00Z`) : null
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(5, 10) !== birthday) throw new Error('Нужны подтверждённые месяц и день MM-DD.')
  const ref = db.doc(`families/${familyId}/children/${childId}`)
  await db.runTransaction(async (tx) => {
    const child = await tx.get(ref)
    if (!child.exists || child.data()?.active === false) throw new Error('Активный профиль ребёнка не найден.')
    tx.update(ref, { birthday, birthdaySource: 'parent-confirmed', birthdayConfirmedAt: Timestamp.now() })
  })
  const child = await ref.get()
  if (child.data()?.birthday !== birthday || child.data()?.birthdaySource !== 'parent-confirmed') throw new Error('Обратная проверка дня рождения не прошла.')
  return { familyId, childId, birthday, verified: true }
}
