#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { operatorFirestore } from './lib/admin-firebase.mjs'

/** Read-only verification after a family/auth change.
 * @see ../docs/architecture/family-data-model.md#migration */
const file = resolve('.local/family-access.json')
if (!existsSync(file)) throw new Error('Локальный реестр семьи не найден.')
const registry = JSON.parse(readFileSync(file, 'utf8'))
const db = operatorFirestore()
const failures = []
const counts = { families: 0, children: 0, adults: 0, students: 0, links: 0, grants: 0, invites: 0, sourceIdentities: 0, sourceAccounts: 0, legacyDays: 0 }
const check = (condition, message) => { if (!condition) failures.push(message) }
const hash = (value) => createHash('sha256').update(value).digest('hex')

for (const [familyId, family] of Object.entries(registry.families)) {
  const familyDoc = await db.doc(`families/${familyId}`).get()
  check(familyDoc.exists, `Семья ${familyId}: документа нет`)
  counts.families++
  const childIds = new Set(family.childIds)
  for (const childId of childIds) {
    const childDoc = await db.doc(`families/${familyId}/children/${childId}`).get()
    check(childDoc.exists, `Семья ${familyId}: нет ребёнка ${childId}`)
    counts.children++
  }
  for (const [personId, person] of Object.entries(registry.people)) {
    if (person.familyId !== familyId) continue
    const [profile, pointer, member] = await Promise.all([
      db.doc(`users/${personId}`).get(),
      db.doc(`users/${personId}/families/${familyId}`).get(),
      db.doc(`families/${familyId}/members/${personId}`).get(),
    ])
    check(profile.exists && pointer.exists && member.exists, `Профиль ${personId}: неполная семейная связь`)
    check(member.data()?.active === true && member.data()?.role === person.role, `Профиль ${personId}: роль или доступ не совпадают`)
    check((member.data()?.childIds ?? []).every((childId) => childIds.has(childId)), `Профиль ${personId}: есть чужой ребёнок`)
    if (person.role === 'parent') counts.adults++
    else {
      counts.students++
      check(childIds.has(person.childId) && member.data()?.childIds?.includes(person.childId), `Ученик ${personId}: связь с ребёнком не совпадает`)
    }
    const tokens = registry.links[personId] ?? []
    check(tokens.length > 0, `Профиль ${personId}: нет личной ссылки`)
    for (const token of tokens) {
      const grant = await db.doc(`accessLinks/${token}`).get()
      check(grant.exists && grant.data()?.personId === personId, `Профиль ${personId}: личная ссылка не совпадает`)
      counts.links++
      if (person.role === 'student') {
        const projection = await db.doc(`families/${familyId}/children/${person.childId}/accessGrants/${hash(token)}`).get()
        check(projection.exists && projection.data()?.personId === personId
          && projection.data()?.active === (grant.data()?.active === true), `Ученик ${personId}: карточка доступа не совпадает`)
        counts.grants++
      }
    }
  }
  const identities = await db.collection('sourceIdentities').where('familyId', '==', familyId).get()
  for (const identity of identities.docs) {
    check(childIds.has(identity.data().childId), `Семья ${familyId}: МЭШ связан с чужим ребёнком`)
    counts.sourceIdentities++
  }
  const accounts = await db.collection('sourceAccounts').where('familyId', '==', familyId).get()
  for (const account of accounts.docs) {
    const parent = registry.people[account.data().personId]
    check(parent?.familyId === familyId && parent.role === 'parent', `Семья ${familyId}: учётная запись МЭШ связана с чужим взрослым`)
    counts.sourceAccounts++
  }
}

const inviteFile = resolve('.local/connection-invites.json')
if (existsSync(inviteFile)) {
  const invites = JSON.parse(readFileSync(inviteFile, 'utf8')).invites ?? {}
  for (const [code, invite] of Object.entries(invites)) {
    const root = await db.doc(`connectionInvites/${code}`).get()
    check(root.exists, 'Приглашение отсутствует в Firestore')
    if (invite.issuerPersonId) {
      const [owner, family] = await Promise.all([
        db.doc(`users/${invite.issuerPersonId}/invites/${code}`).get(),
        db.doc(`families/${invite.issuerFamilyId}/invites/${code}`).get(),
      ])
      check(owner.exists && family.exists, 'История приглашения не видна создателю или семье')
      check(owner.data()?.status === root.data()?.status && family.data()?.status === root.data()?.status,
        'Статусы приглашения в кабинете и Firestore различаются')
    }
    counts.invites++
  }
}

const old = registry.legacyDayOwner
if (old) {
  const ownerDocs = await db.collection('dayOwners').get()
  for (const owner of ownerDocs.docs) {
    check(owner.data().familyId === old.familyId && owner.data().childId === old.childId, `Старый календарь ${owner.id}: владелец изменился`)
    const page = await db.doc(`dayPages/${owner.id}`).get()
    check(page.exists && page.data()?.kind === 'student', `Старый календарь ${owner.id}: страница ученика не найдена`)
    counts.legacyDays++
  }
  for (const [personId, person] of Object.entries(registry.people)) {
    if (person.familyId !== old.familyId || (person.role === 'student' && person.childId !== old.childId)) continue
    const shortcut = await db.doc(`users/${personId}/families/${old.familyId}/shortcuts/${old.childId}`).get()
    check(shortcut.exists && typeof shortcut.data()?.dashboardToken === 'string' && typeof shortcut.data()?.dayToken === 'string', `Профиль ${personId}: переход к прежнему календарю отсутствует`)
  }
}

console.log(JSON.stringify({ counts, failures }, null, 2))
if (failures.length) process.exitCode = 1
