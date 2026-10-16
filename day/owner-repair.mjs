/** A historical page can inherit only its explicit dayOwners record. Never
 * infer ownership from a token, textbook, school or another page.
 * @see ../docs/shared/data/firestore.md#migration */
export function ownerMigrationFields(page, owner) {
  if (!owner?.familyId || !owner?.childId || page?.date !== owner.date || page?.targetDate !== owner.targetDate) {
    throw new Error('Запись владельца не подтверждает дату и ребёнка этой страницы.')
  }
  if (page.familyId && page.familyId !== owner.familyId || page.childId && page.childId !== owner.childId) {
    throw new Error('У страницы уже указан другой владелец.')
  }
  return { familyId: owner.familyId, childId: owner.childId }
}
