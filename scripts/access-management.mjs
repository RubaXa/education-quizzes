#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Timestamp } from 'firebase-admin/firestore'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { grantId, syncChildAccess } from './lib/access-projection.mjs'

/** Hybrid operator side of browser access requests.
 * @see ../docs/modules/families/README.md#parent-home */
const db = operatorFirestore()
const file = resolve('.local/family-access.json')
if (!existsSync(file)) throw new Error('Локальный реестр семьи не найден.')
const registry = JSON.parse(readFileSync(file, 'utf8'))
const idPattern = /^[A-Za-z0-9_-]{1,80}$/
const secret = () => randomBytes(32).toString('base64url')
function save() {
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`
  writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, file)
}
function familyChild(familyId, childId) {
  if (!idPattern.test(familyId) || !idPattern.test(childId)
    || !registry.families[familyId]?.childIds.includes(childId)) throw new Error('Ребёнок не найден в этой семье.')
}
async function sync(familyId) {
  if (!idPattern.test(familyId) || !registry.families[familyId]) throw new Error('Семья не найдена.')
  let count = 0
  for (const childId of registry.families[familyId].childIds) count += await syncChildAccess(db, registry, familyId, childId)
  for (const [personId, person] of Object.entries(registry.people)) {
    if (person.familyId !== familyId) continue
    await db.doc(`families/${familyId}/members/${personId}`).update({ displayName: person.displayName })
  }
  console.log(`Семейные профили и личные ссылки сверены. Детских ссылок: ${count}. Учебные документы не изменены.`)
}
async function processRequests(familyId, childId) {
  familyChild(familyId, childId)
  const requests = await db.collection(`families/${familyId}/children/${childId}/accessRequests`).where('status', '==', 'requested').get()
  const student = Object.entries(registry.people).find(([, item]) => item.familyId === familyId
    && item.childId === childId && item.role === 'student')
  if (!student) throw new Error('У ребёнка нет постоянного профиля ученика.')
  let issuedRotation = false
  for (const request of requests.docs) {
    const data = request.data()
    const member = await db.doc(`families/${familyId}/members/${data.actorPersonId}`).get()
    if (!['rotate', 'revoke'].includes(data.action) || member.data()?.role !== 'parent' || member.data()?.active !== true
      || !member.data()?.childIds?.includes(childId)) {
      await request.ref.update({ status: 'rejected', processedAt: Timestamp.now() })
      continue
    }
    const [personId] = student
    if (data.action === 'revoke') {
      const token = (registry.links[personId] ?? []).find((item) => grantId(item) === data.grantId)
      const grant = token ? await db.doc(`accessLinks/${token}`).get() : null
      if (!token || grant?.data()?.personId !== personId || grant.data().active !== true) {
        await request.ref.update({ status: 'rejected', processedAt: Timestamp.now() })
        continue
      }
      const at = Timestamp.now()
      const batch = db.batch()
      batch.update(grant.ref, { active: false, revokedAt: at })
      batch.update(db.doc(`families/${familyId}/children/${childId}/accessGrants/${data.grantId}`), { active: false, revokedAt: at, checkedAt: at })
      batch.update(request.ref, { status: 'processed', processedAt: at })
      await batch.commit()
      continue
    }
    if (issuedRotation) {
      await request.ref.update({ status: 'rejected', processedAt: Timestamp.now() })
      continue
    }
    const token = secret()
    const issuedAt = Timestamp.now()
    registry.links[personId] ??= []
    registry.links[personId].push(token)
    save()
    const batch = db.batch()
    batch.create(db.doc(`accessLinks/${token}`), { personId, active: true, createdAt: issuedAt })
    batch.create(db.doc(`families/${familyId}/children/${childId}/accessGrants/${grantId(token)}`), {
      personId, linkUrl: `https://rubaxa.github.io/education-quizzes/#/enter/${token}`,
      active: true, createdAt: issuedAt, revokedAt: null, sessionCount: 0, checkedAt: issuedAt,
    })
    batch.update(request.ref, { status: 'issued', grantId: grantId(token), processedAt: issuedAt })
    try { await batch.commit() }
    catch (error) { registry.links[personId].pop(); save(); throw error }
    issuedRotation = true
  }
  console.log(`Обработано заявок на ссылки: ${requests.size}. При выпуске новой старая сохраняется до отдельного отзыва.`)
}

const [command, familyId, childId] = process.argv.slice(2)
try {
  if (!existsSync(file)) throw new Error('Локальный реестр семьи не найден.')
  if (command === 'sync') await sync(familyId)
  else if (command === 'process') await processRequests(familyId, childId)
  else throw new Error('Команды: sync <familyId>; process <familyId> <childId>.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
