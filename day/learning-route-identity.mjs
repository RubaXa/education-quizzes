/** Stable resource identity; URL aliases are never an authorization role.
 * @see ../docs/modules/families/access-and-state.md#authenticated-learning-routes */
export function learningRouteIdentity(pair, owner) {
  if (![pair?.student, pair?.parent, owner?.familyId, owner?.childId].every((value) => typeof value === 'string' && value.trim()) || pair.student === pair.parent) throw new Error('Для общей ссылки нужны две проекции одного ребёнка.')
  return { familyId: owner.familyId, childId: owner.childId, canonicalToken: pair.student,
    viewTokens: { student: pair.student, parent: pair.parent } }
}

export function assertLearningRouteIdentity(data, expected) {
  if (!data || ['familyId', 'childId', 'canonicalToken'].some((field) => data[field] !== expected[field])
    || data.viewTokens?.student !== expected.viewTokens.student || data.viewTokens?.parent !== expected.viewTokens.parent) throw new Error('Обратная проверка общей учебной ссылки не совпала с владельцем и проекциями.')
}

export function learningDayAliases(links) {
  return Object.fromEntries(Object.values(links).filter((pair) => typeof pair?.student === 'string' && typeof pair?.parent === 'string')
    .flatMap((pair) => [[pair.student, pair.student], [pair.parent, pair.student]]))
}
