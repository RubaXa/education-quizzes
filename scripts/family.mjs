/**
 * @see ../docs/product/families.md
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { syncChildAccess } from './lib/access-projection.mjs'

/** Agent-only provisioning; there is deliberately no browser administration route.
 * @see ../docs/modules/families/README.md#provisioning
 */
const registryPath = resolve('.local/family-access.json')
const site = 'https://rubaxa.github.io/education-quizzes/'
const [command, ...args] = process.argv.slice(2)
const id = () => randomBytes(16).toString('base64url')
const secret = () => randomBytes(32).toString('base64url')
const fail = (message) => { throw new Error(message) }
const cleanName = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) fail('Укажите короткое имя профиля.')
  return value.trim()
}
const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : { families: {}, people: {}, links: {} }

function saveRegistry() {
  mkdirSync(resolve('.local'), { recursive: true })
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 })
}
function family(familyId) {
  if (!registry.families[familyId]) fail('Семья не найдена в локальном реестре.')
  return registry.families[familyId]
}
function person(personId) {
  if (!registry.people[personId]) fail('Профиль не найден в локальном реестре.')
  return registry.people[personId]
}
function requireFamilyPerson(familyId, personId) {
  const entry = person(personId)
  if (entry.familyId !== familyId) fail('Профиль относится к другой семье.')
  return entry
}
function splitIds(value) { return value ? value.split(',').filter(Boolean) : [] }

const db = operatorFirestore()
const now = Timestamp.now()

async function createFamily(childName, parentName) {
  childName = cleanName(childName)
  parentName = cleanName(parentName)
  const familyId = id(), childId = id(), studentId = id(), parentId = id()
  const studentLink = secret(), parentLink = secret()
  const batch = db.batch()
  batch.set(db.doc(`families/${familyId}`), { schemaVersion: 2, createdAt: now })
  batch.set(db.doc(`families/${familyId}/children/${childId}`), { displayName: childName, timezone: 'Europe/Moscow', libraryPolicyVersion: 1, createdAt: now })
  for (const [personId, name, role, link] of [[studentId, childName, 'student', studentLink], [parentId, parentName, 'parent', parentLink]]) {
    batch.set(db.doc(`users/${personId}`), { displayName: name, createdAt: now })
    batch.set(db.doc(`users/${personId}/families/${familyId}`), { createdAt: now })
    batch.set(db.doc(`families/${familyId}/members/${personId}`), { role, displayName: name, active: true, childIds: [childId], createdAt: now })
    batch.set(db.doc(`accessLinks/${link}`), { personId, active: true, createdAt: now })
  }
  await batch.commit()
  registry.families[familyId] = { childIds: [childId] }
  registry.people[studentId] = { familyId, childId, role: 'student', displayName: childName }
  registry.people[parentId] = { familyId, role: 'parent', displayName: parentName }
  registry.links[studentId] = [studentLink]
  registry.links[parentId] = [parentLink]
  saveRegistry()
  await syncChildAccess(db, registry, familyId, childId)
  console.log(`Семья: ${familyId}\nРебёнок: ${childId}\nПрофиль ученика: ${studentId}\nПрофиль родителя: ${parentId}`)
  console.log('Личные ссылки сохранены в закрытом реестре. Для выдачи используйте link-url <personId>.')
}

async function addParent(familyId, name, childList) {
  const group = family(familyId)
  name = cleanName(name)
  const childIds = splitIds(childList)
  if (!childIds.length || childIds.some((childId) => !group.childIds.includes(childId))) fail('Укажите ID детей этой семьи через запятую.')
  const personId = id(), link = secret(), batch = db.batch()
  batch.set(db.doc(`users/${personId}`), { displayName: name, createdAt: now })
  batch.set(db.doc(`users/${personId}/families/${familyId}`), { createdAt: now })
  batch.set(db.doc(`families/${familyId}/members/${personId}`), { role: 'parent', displayName: name, active: true, childIds, createdAt: now })
  batch.set(db.doc(`accessLinks/${link}`), { personId, active: true, createdAt: now })
  await batch.commit()
  registry.people[personId] = { familyId, role: 'parent', displayName: name }
  registry.links[personId] = [link]
  saveRegistry()
  if (registry.legacyDayOwner?.familyId === familyId && childIds.includes(registry.legacyDayOwner.childId)) {
    try { await attachCurrentDay(familyId, registry.legacyDayOwner.childId) }
    catch { console.warn('Переход к старой странице дня ещё не добавлен; профиль создан.') }
  }
  console.log(`Профиль родителя: ${personId}\nЛичная ссылка сохранена в закрытом реестре.`)
}

async function addChild(familyId, name, parentList) {
  const group = family(familyId)
  name = cleanName(name)
  const parentIds = splitIds(parentList)
  for (const parentId of parentIds) {
    const entry = requireFamilyPerson(familyId, parentId)
    if (entry.role !== 'parent') fail('Связать ребёнка можно только с родительским профилем.')
  }
  const childId = id(), personId = id(), link = secret(), batch = db.batch()
  batch.set(db.doc(`families/${familyId}/children/${childId}`), { displayName: name, timezone: 'Europe/Moscow', libraryPolicyVersion: 1, createdAt: now })
  batch.set(db.doc(`users/${personId}`), { displayName: name, createdAt: now })
  batch.set(db.doc(`users/${personId}/families/${familyId}`), { createdAt: now })
  batch.set(db.doc(`families/${familyId}/members/${personId}`), { role: 'student', displayName: name, active: true, childIds: [childId], createdAt: now })
  batch.set(db.doc(`accessLinks/${link}`), { personId, active: true, createdAt: now })
  for (const parentId of parentIds) batch.update(db.doc(`families/${familyId}/members/${parentId}`), { childIds: FieldValue.arrayUnion(childId) })
  await batch.commit()
  group.childIds.push(childId)
  registry.people[personId] = { familyId, childId, role: 'student', displayName: name }
  registry.links[personId] = [link]
  saveRegistry()
  await syncChildAccess(db, registry, familyId, childId)
  console.log(`Ребёнок: ${childId}\nПрофиль ученика: ${personId}\nЛичная ссылка сохранена в закрытом реестре.`)
}

async function linkParent(familyId, parentId, childId) {
  const group = family(familyId)
  const entry = requireFamilyPerson(familyId, parentId)
  if (entry.role !== 'parent' || !group.childIds.includes(childId)) fail('Нужны родитель и ребёнок одной семьи.')
  await db.doc(`families/${familyId}/members/${parentId}`).update({ childIds: FieldValue.arrayUnion(childId) })
  if (registry.legacyDayOwner?.familyId === familyId && registry.legacyDayOwner.childId === childId) {
    try { await attachCurrentDay(familyId, childId) }
    catch { console.warn('Переход к старой странице дня ещё не добавлен; связь создана.') }
  }
  console.log('Связь родителя с ребёнком добавлена.')
}

async function issueLink(personId) {
  person(personId)
  const link = secret()
  await db.doc(`accessLinks/${link}`).create({ personId, active: true, createdAt: now })
  registry.links[personId] ??= []
  registry.links[personId].push(link)
  saveRegistry()
  const entry = registry.people[personId]
  if (entry.role === 'student') await syncChildAccess(db, registry, entry.familyId, entry.childId)
  console.log('Новая личная ссылка сохранена в закрытом реестре.')
}

async function showLink(personId) {
  person(personId)
  for (const link of [...(registry.links[personId] ?? [])].reverse()) {
    const grant = await db.doc(`accessLinks/${link}`).get()
    if (grant.data()?.personId === personId && grant.data()?.active === true) {
      console.log(`${site}#/enter/${link}`)
      return
    }
  }
  fail('Действующей ссылки нет. Сначала используйте issue-link.')
}

async function linkStatus(personId) {
  const entry = person(personId)
  const links = registry.links[personId] ?? []
  const rows = await Promise.all(links.map(async (link, index) => {
    const [grant, sessions] = await Promise.all([
      db.doc(`accessLinks/${link}`).get(),
      db.collection('deviceSessions').where('linkToken', '==', link).count().get(),
    ])
    if (grant.exists && grant.data()?.personId !== personId) fail('Связь личной ссылки с профилем не совпадает.')
    return { number: index + 1, active: grant.data()?.active === true, devices: sessions.data().count,
      createdAt: grant.data()?.createdAt?.toDate?.()?.toISOString() ?? null }
  }))
  console.log(JSON.stringify({ role: entry.role, links: rows }, null, 2))
}

async function revokeOldLinks(personId, confirmation) {
  const entry = person(personId)
  if (confirmation !== '--confirmed') fail('После входа по новой ссылке повторите команду с --confirmed.')
  const links = registry.links[personId] ?? []
  if (links.length < 2) fail('Новой и прежней ссылок одновременно нет.')
  const newest = links.at(-1)
  const grants = await Promise.all(links.map((link) => db.doc(`accessLinks/${link}`).get()))
  if (grants.some((grant) => !grant.exists || grant.data()?.personId !== personId)) fail('Связи ссылок с профилем не совпадают.')
  if (grants.at(-1).data()?.active !== true) fail('Новая ссылка уже закрыта.')
  const sessions = await db.collection('deviceSessions').where('linkToken', '==', newest).count().get()
  if (sessions.data().count < 1) fail('По новой ссылке ещё не вошли ни на одном устройстве.')
  const old = grants.slice(0, -1).filter((grant) => grant.data()?.active === true)
  if (!old.length) return console.log('Прежние ссылки уже отозваны.')
  const batch = db.batch()
  for (const grant of old) batch.update(grant.ref, { active: false, revokedAt: now })
  await batch.commit()
  if (entry.role === 'student') await syncChildAccess(db, registry, entry.familyId, entry.childId)
  console.log(`Отозвано прежних ссылок: ${old.length}. Новая ссылка и профиль сохранены.`)
}

async function revokeLinks(personId, confirmation) {
  person(personId)
  if (confirmation !== '--force') fail('Отзыв всех ссылок оставит профиль без входа. Повторите с --force.')
  const links = registry.links[personId] ?? []
  if (!links.length) return console.log('Ссылок в локальном реестре нет.')
  const grants = await Promise.all(links.map((link) => db.doc(`accessLinks/${link}`).get()))
  if (grants.some((grant) => !grant.exists || grant.data()?.personId !== personId)) fail('Связи ссылок с профилем не совпадают.')
  const active = grants.filter((grant) => grant.data()?.active === true)
  if (!active.length) return console.log('Все ссылки уже отозваны.')
  const batch = db.batch()
  for (const grant of active) batch.update(grant.ref, { active: false, revokedAt: now })
  await batch.commit()
  const entry = registry.people[personId]
  if (entry.role === 'student') await syncChildAccess(db, registry, entry.familyId, entry.childId)
  console.log(`Отозвано ссылок: ${active.length}. История сохранена в закрытом реестре.`)
}

async function attachCurrentDay(familyId, childId) {
  const group = family(familyId)
  if (!group.childIds.includes(childId)) fail('Ребёнок не входит в семью.')
  if (registry.legacyDayOwner && (registry.legacyDayOwner.familyId !== familyId || registry.legacyDayOwner.childId !== childId)) {
    fail('Текущие страницы дня уже закреплены за другим ребёнком. Нельзя раздать его страницы другой семье.')
  }
  const linksPath = resolve('.local/day-links.json')
  const dashboardsPath = resolve('.local/day-dashboard-links.json')
  if (!existsSync(linksPath)) fail('Локальные ссылки страниц дня не найдены.')
  const days = JSON.parse(readFileSync(linksPath, 'utf8'))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const dates = Object.keys(days).sort()
  const date = dates.filter((item) => item <= today).at(-1) ?? dates[0]
  if (!date) fail('Опубликованные страницы дня не найдены.')
  const links = days[date]
  const dashboards = existsSync(dashboardsPath) ? JSON.parse(readFileSync(dashboardsPath, 'utf8')) : {}
  // The private owner map lets the agent discover submissions without guessing
  // a child's day token. It is never readable from the public client.
  // @see ../docs/modules/materials/storage-privacy.md#review-queue
  const ownerEntries = []
  for (const [dayDate, pair] of Object.entries(days)) {
    if (!pair?.student) fail(`У страницы ${dayDate} нет ученического токена.`)
    const [page, previous] = await Promise.all([
      db.doc(`dayPages/${pair.student}`).get(),
      db.doc(`dayOwners/${pair.student}`).get(),
    ])
    if (!page.exists || page.data().kind !== 'student' || page.data().date !== dayDate) fail(`Ученическая страница ${dayDate} не совпадает с реестром.`)
    if (previous.exists && (previous.data().familyId !== familyId || previous.data().childId !== childId)) fail(`Страница ${dayDate} уже закреплена за другим ребёнком.`)
    ownerEntries.push({ ref: db.doc(`dayOwners/${pair.student}`), date: dayDate, targetDate: page.data().targetDate })
  }
  const ownerBatch = db.batch()
  for (const item of ownerEntries) ownerBatch.set(item.ref, {
    schemaVersion: 1, familyId, childId, date: item.date, targetDate: item.targetDate, updatedAt: now,
  }, { merge: true })
  if (ownerEntries.length > 400) fail('Слишком много страниц для одной операции привязки.')
  await ownerBatch.commit()
  const batch = db.batch()
  let count = 0
  for (const [personId, entry] of Object.entries(registry.people)) {
    if (entry.familyId !== familyId) continue
    const member = await db.doc(`families/${familyId}/members/${personId}`).get()
    if (!member.data()?.childIds?.includes(childId)) continue
    batch.set(db.doc(`users/${personId}/families/${familyId}/shortcuts/${childId}`), {
      dayToken: links[entry.role], dashboardToken: dashboards[entry.role] ?? null, sourceDate: date, updatedAt: now,
    })
    count++
  }
  await batch.commit()
  registry.legacyDayOwner = { familyId, childId }
  saveRegistry()
  console.log(`Личные переходы к странице ${date} опубликованы для ${count} профилей.`)
}

switch (command) {
  case 'create': await createFamily(args[0], args[1]); break
  case 'add-parent': await addParent(args[0], args[1], args[2]); break
  case 'add-child': await addChild(args[0], args[1], args[2]); break
  case 'link': await linkParent(args[0], args[1], args[2]); break
  case 'issue-link': await issueLink(args[0]); break
  case 'link-url': await showLink(args[0]); break
  case 'link-status': await linkStatus(args[0]); break
  case 'revoke-old-links': await revokeOldLinks(args[0], args[1]); break
  case 'revoke-links': await revokeLinks(args[0], args[1]); break
  case 'attach-current-day': await attachCurrentDay(args[0], args[1]); break
  default: fail('Команды: create <имя ребёнка> <имя родителя>; add-parent <familyId> <имя> <childIds>; add-child <familyId> <имя> [parentIds]; link <familyId> <parentId> <childId>; issue-link <personId>; link-url <personId>; link-status <personId>; revoke-old-links <personId> --confirmed; revoke-links <personId> --force; attach-current-day <familyId> <childId>')
}
