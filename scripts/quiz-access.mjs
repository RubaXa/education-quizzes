export function assertQuizOwner(assignment, owner) {
  if (!owner?.familyId || !owner?.childId) throw new Error('Нет подтверждённой семейной связи с ребёнком.')
  if (assignment?.familyId !== owner.familyId || assignment?.childId !== owner.childId) {
    throw new Error('Тест не привязан к нужной семье и ребёнку; ученик не сможет сохранить ответ.')
  }
}
