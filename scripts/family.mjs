import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'

/** Agent-only provisioning; there is deliberately no browser administration route.
 * @see ../docs/architecture/family-data-model.md#provisioning
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
function prepareCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return
  const file = resolve('.local/adc.json')
  if (existsSync(file)) { process.env.GOOGLE_APPLICATION_CREDENTIALS = file; return }
  const loginFile = resolve('.local/config/configstore/firebase-tools.json')
  if (!existsSync(loginFile)) fail('Нужен локальный вход Firebase CLI.')
  const login = JSON.parse(readFileSync(loginFile, 'utf8'))
  if (!login.tokens?.refresh_token) fail('Вход Firebase CLI устарел.')
  const require = createRequire(import.meta.url)
  const { clientId, clientSecret } = require('firebase-tools/lib/api')
  writeFileSync(file, JSON.stringify({ type: 'authorized_user', client_id: clientId(), client_secret: clientSecret(), refresh_token: login.tokens.refresh_token }), { mode: 0o600 })
  process.env.GOOGLE_APPLICATION_CREDENTIALS = file
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

prepareCredentials()
initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
const db = getFirestore()
const now = Timestamp.now()

async function createFamily(childName, parentName) {
  childName = cleanName(childName)
  parentName = cleanName(parentName)
  const familyId = id(), childId = id(), studentId = id(), parentId = id()
  const studentLink = secret(), parentLink = secret()
  const batch = db.batch()
  batch.set(db.doc(`families/${familyId}`), { schemaVersion: 2, createdAt: now })
  batch.set(db.doc(`families/${familyId}/children/${childId}`), { displayName: childName, timezone: 'Europe/Moscow', createdAt: now })
  for (const [personId, name, role, link] of [[studentId, childName, 'student', studentLink], [parentId, parentName, 'parent', parentLink]]) {
    batch.set(db.doc(`users/${personId}`), { displayName: name, createdAt: now })
    batch.set(db.doc(`users/${personId}/families/${familyId}`), { createdAt: now })
    batch.set(db.doc(`families/${familyId}/members/${personId}`), { role, active: true, childIds: [childId], createdAt: now })
    batch.set(db.doc(`accessLinks/${link}`), { personId, active: true, createdAt: now })
  }
  await batch.commit()
  registry.families[familyId] = { childIds: [childId] }
  registry.people[studentId] = { familyId, childId, role: 'student', displayName: childName }
  registry.people[parentId] = { familyId, role: 'parent', displayName: parentName }
  registry.links[studentId] = [studentLink]
  registry.links[parentId] = [parentLink]
  saveRegistry()
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
  batch.set(db.doc(`families/${familyId}/members/${personId}`), { role: 'parent', active: true, childIds, createdAt: now })
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
  batch.set(db.doc(`families/${familyId}/children/${childId}`), { displayName: name, timezone: 'Europe/Moscow', createdAt: now })
  batch.set(db.doc(`users/${personId}`), { displayName: name, createdAt: now })
  batch.set(db.doc(`users/${personId}/families/${familyId}`), { createdAt: now })
  batch.set(db.doc(`families/${familyId}/members/${personId}`), { role: 'student', active: true, childIds: [childId], createdAt: now })
  batch.set(db.doc(`accessLinks/${link}`), { personId, active: true, createdAt: now })
  for (const parentId of parentIds) batch.update(db.doc(`families/${familyId}/members/${parentId}`), { childIds: FieldValue.arrayUnion(childId) })
  await batch.commit()
  group.childIds.push(childId)
  registry.people[personId] = { familyId, childId, role: 'student', displayName: name }
  registry.links[personId] = [link]
  saveRegistry()
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
  await db.doc(`accessLinks/${link}`).set({ personId, active: true, createdAt: now })
  registry.links[personId] ??= []
  registry.links[personId].push(link)
  saveRegistry()
  console.log('Новая личная ссылка сохранена в закрытом реестре.')
}

function showLink(personId) {
  person(personId)
  const link = registry.links[personId]?.at(-1)
  if (!link) fail('Действующей ссылки нет. Сначала используйте issue-link.')
  console.log(`${site}#/enter/${link}`)
}

async function revokeLinks(personId) {
  person(personId)
  const links = registry.links[personId] ?? []
  if (!links.length) return console.log('Действующих ссылок в локальном реестре нет.')
  const batch = db.batch()
  for (const link of links) batch.update(db.doc(`accessLinks/${link}`), { active: false, revokedAt: now })
  await batch.commit()
  registry.links[personId] = []
  saveRegistry()
  console.log(`Отозвано ссылок: ${links.length}`)
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
  case 'link-url': showLink(args[0]); break
  case 'revoke-links': await revokeLinks(args[0]); break
  case 'attach-current-day': await attachCurrentDay(args[0], args[1]); break
  default: fail('Команды: create <имя ребёнка> <имя родителя>; add-parent <familyId> <имя> <childIds>; add-child <familyId> <имя> [parentIds]; link <familyId> <parentId> <childId>; issue-link <personId>; link-url <personId>; revoke-links <personId>; attach-current-day <familyId> <childId>')
}
