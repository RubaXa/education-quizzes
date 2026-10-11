#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { decryptHandoff, generateReceiverKeys } from '../packages/education-connect/lib/envelope.mjs'
import { MeshDiaryAdapter } from '../packages/education-connect/lib/mesh.mjs'
import { syncChildAccess } from './lib/access-projection.mjs'

/** Operator-only invite and intake. @see ../docs/architecture/school-diary-port-adapter.md#family-onboarding-research */
const db = operatorFirestore()
const site = 'https://rubaxa.github.io/education-quizzes/'
const inviteFile = resolve('.local/connection-invites.json')
const familyFile = resolve('.local/family-access.json')
const codePattern = /^[A-Za-z0-9_-]{43}$/
const id = () => randomBytes(16).toString('base64url')
const secret = () => randomBytes(32).toString('base64url')
const sourceKey = (prefix, value) => createHash('sha256').update(`${prefix}:${value}`).digest('hex')
const fail = (message) => { throw new Error(message) }
const read = (file, fallback) => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
const invites = read(inviteFile, { invites: {} })
const families = read(familyFile, { families: {}, people: {}, links: {} })

function save(file, data) {
  mkdirSync(resolve('.local'), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, file)
}

function option(args, name, fallback = null) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

async function issue(args) {
  const targetFamilyId = option(args, '--family')
  if (targetFamilyId && !families.families[targetFamilyId]) fail('Семья не найдена в локальном реестре.')
  const ttlDays = Number(option(args, '--days', '7'))
  const delegateQuota = Number(option(args, '--delegates', '0'))
  const issuerPersonId = option(args, '--issuer')
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 30 || !Number.isInteger(delegateQuota) || delegateQuota < 0 || delegateQuota > 1000) {
    fail('Срок: 1–30 дней; лимит приглашений: 0–1000.')
  }
  if (!issuerPersonId) return createInvite({ targetFamilyId, ttlDays, delegateQuota })
  const issuer = families.people[issuerPersonId]
  if (!issuer || issuer.role !== 'parent') fail('Создатель приглашения не найден среди взрослых.')
  const memberRef = db.doc(`families/${issuer.familyId}/members/${issuerPersonId}`)
  const member = await memberRef.get()
  if (member.data()?.active !== true || member.data()?.role !== 'parent'
    || (member.data()?.inviteUnlimited !== true && Number(member.data()?.inviteQuota) <= 0)) {
    fail('У взрослого нет права выдавать приглашение.')
  }
  return createInvite({ targetFamilyId, ttlDays, delegateQuota, issuerPersonId,
    quotaRef: member.data()?.inviteUnlimited === true ? null : memberRef })
}

async function createInvite({ targetFamilyId, ttlDays, delegateQuota, issuerPersonId, requestRef = null, quotaRef = null }) {
  const issuer = issuerPersonId ? families.people[issuerPersonId] : null
  if (issuerPersonId && (!issuer || issuer.role !== 'parent')) fail('Создатель приглашения не найден среди взрослых.')
  if (targetFamilyId && issuer && issuer.familyId !== targetFamilyId) fail('Приглашение в другую семью запрещено.')
  const code = secret()
  const pair = generateReceiverKeys()
  const now = Date.now()
  invites.invites[code] = { privateKey: pair.privateKey, issuedAt: new Date(now).toISOString(), targetFamilyId: targetFamilyId ?? null, delegateQuota, issuerPersonId: issuerPersonId ?? null, issuerFamilyId: issuer?.familyId ?? null }
  save(inviteFile, invites)
  const batch = db.batch()
  batch.create(db.doc(`connectionInvites/${code}`), {
    schemaVersion: 1, status: 'open', publicKey: pair.publicKey,
    createdAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + ttlDays * 86400000),
  })
  const projection = {
    status: 'open', mode: targetFamilyId ? 'same-family' : 'new-family', delegateQuota,
    createdAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + ttlDays * 86400000),
    requestId: requestRef?.id ?? null, issuerPersonId: issuerPersonId ?? null,
    originFamilyId: issuer?.familyId ?? null,
  }
  if (issuerPersonId) {
    batch.create(db.doc(`users/${issuerPersonId}/invites/${code}`), projection)
    batch.create(db.doc(`families/${issuer.familyId}/invites/${code}`), projection)
  }
  if (requestRef) batch.update(requestRef, { status: 'issued', inviteCode: code, processedAt: Timestamp.now() })
  if (quotaRef) batch.update(quotaRef, { inviteQuota: FieldValue.increment(-1) })
  try { await batch.commit() }
  catch (error) { delete invites.invites[code]; save(inviteFile, invites); throw error }
  console.log(`Приглашение: ${site}#/connect/${code}`)
  console.log(`Команда подключения: npx education-connect --invite ${code}`)
  console.log(`Срок: ${ttlDays} дней; адресату выделено приглашений: ${delegateQuota}.`)
}

async function processRequests(parentPersonId) {
  const issuer = families.people[parentPersonId]
  if (!issuer || issuer.role !== 'parent') fail('Взрослый не найден в локальном реестре.')
  const requests = await db.collection(`users/${parentPersonId}/inviteRequests`).where('status', '==', 'requested').get()
  const memberRef = db.doc(`families/${issuer.familyId}/members/${parentPersonId}`)
  for (const request of requests.docs) {
    const data = request.data()
    if (data.familyId !== issuer.familyId || !['same-family', 'new-family'].includes(data.mode)
      || !Number.isInteger(data.delegateQuota) || data.delegateQuota < 0 || data.delegateQuota > 1000) fail('Заявка на приглашение требует ручной проверки.')
    const member = await memberRef.get()
    const canIssue = member.data()?.active === true && member.data()?.role === 'parent'
      && (member.data()?.inviteUnlimited === true || Number(member.data()?.inviteQuota) > 0)
    if (!canIssue) {
      await request.ref.update({ status: 'rejected', reason: 'Нет права выдавать приглашения', processedAt: Timestamp.now() })
      continue
    }
    await createInvite({ targetFamilyId: data.mode === 'same-family' ? issuer.familyId : null,
      ttlDays: 7, delegateQuota: data.delegateQuota, issuerPersonId: parentPersonId,
      requestRef: request.ref, quotaRef: member.data()?.inviteUnlimited === true ? null : memberRef })
  }
  console.log(`Обработано заявок на приглашения: ${requests.size}.`)
}

async function processRevocations(parentPersonId) {
  if (families.people[parentPersonId]?.role !== 'parent') fail('Взрослый не найден в локальном реестре.')
  const requests = await db.collection(`users/${parentPersonId}/inviteRevocations`).where('status', '==', 'requested').get()
  for (const request of requests.docs) {
    const code = request.data().inviteCode
    const creator = invites.invites[code]
    const requester = families.people[parentPersonId]
    const member = requester ? await db.doc(`families/${requester.familyId}/members/${parentPersonId}`).get() : null
    const permitted = creator?.issuerPersonId === parentPersonId
      || (member?.data()?.inviteUnlimited === true && creator?.issuerFamilyId === requester?.familyId)
    if (!codePattern.test(code) || !permitted) {
      await request.ref.update({ status: 'rejected', reason: 'Приглашение не принадлежит заявителю', processedAt: Timestamp.now() })
      continue
    }
    const inviteRef = db.doc(`connectionInvites/${code}`)
    const invite = await inviteRef.get()
    if (invite.data()?.status !== 'open') {
      await request.ref.update({ status: 'rejected', reason: 'Приглашение уже закрыто', processedAt: Timestamp.now() })
      continue
    }
    const batch = db.batch()
    batch.update(inviteRef, { status: 'revoked', revokedAt: Timestamp.now() })
    batch.update(db.doc(`users/${creator.issuerPersonId}/invites/${code}`), { status: 'revoked', revokedAt: Timestamp.now() })
    batch.update(db.doc(`families/${creator.issuerFamilyId}/invites/${code}`), { status: 'revoked', revokedAt: Timestamp.now() })
    batch.delete(inviteRef.collection('handoff').doc('current'))
    batch.update(request.ref, { status: 'processed', processedAt: Timestamp.now() })
    await batch.commit()
    delete invites.invites[code].privateKey
    save(inviteFile, invites)
  }
  console.log(`Обработано заявок на отзыв: ${requests.size}.`)
}

async function promoteCurrentParent(personId) {
  const owner = families.legacyDayOwner
  if (!owner || families.people[personId]?.familyId !== owner.familyId || families.people[personId]?.role !== 'parent') fail('Начальный взрослый не совпадает с действующей семьёй.')
  const ref = db.doc(`families/${owner.familyId}/members/${personId}`)
  const member = await ref.get()
  if (!member.exists || member.data().role !== 'parent' || !member.data().childIds?.includes(owner.childId)) fail('Действующая семейная связь не подтверждена.')
  await ref.update({ inviteUnlimited: true, displayName: families.people[personId].displayName })
  console.log('Начальному взрослому выдано право создавать приглашения без лимита; профиль и учебные данные не изменены.')
}

async function list() {
  for (const code of Object.keys(invites.invites)) {
    const [invitation, handoff] = await Promise.all([
      db.doc(`connectionInvites/${code}`).get(),
      db.doc(`connectionInvites/${code}/handoff/current`).get(),
    ])
    const data = invitation.data()
    const state = data?.status === 'open' && handoff.exists ? 'ожидает обработки' : data?.status ?? 'не найдено'
    const local = invites.invites[code]
    const parentName = families.people[local.parentPersonId]?.displayName ?? '—'
    console.log(`${code}  ${state}  создано ${data?.createdAt?.toDate?.().toISOString() ?? '—'}  лимит ${local.delegateQuota ?? 0}  семья ${local.familyId ?? local.targetFamilyId ?? '—'}  взрослый ${parentName}`)
  }
}

async function revoke(code) {
  if (!codePattern.test(code) || !invites.invites[code]) fail('Приглашение не найдено в локальном реестре.')
  const ref = db.doc(`connectionInvites/${code}`)
  const snapshot = await ref.get()
  if (snapshot.data()?.status !== 'open') fail('Можно отозвать только открытое приглашение.')
  const batch = db.batch()
  batch.update(ref, { status: 'revoked', revokedAt: Timestamp.now() })
  batch.delete(ref.collection('handoff').doc('current'))
  const issuerPersonId = invites.invites[code].issuerPersonId
  if (issuerPersonId) batch.update(db.doc(`users/${issuerPersonId}/invites/${code}`), { status: 'revoked', revokedAt: Timestamp.now() })
  if (issuerPersonId) batch.update(db.doc(`families/${invites.invites[code].issuerFamilyId}/invites/${code}`), { status: 'revoked', revokedAt: Timestamp.now() })
  await batch.commit()
  delete invites.invites[code].privateKey
  save(inviteFile, invites)
  console.log('Приглашение отозвано; ожидавший шифрованный пакет удалён.')
}

async function disconnect(parentPersonId) {
  if (families.people[parentPersonId]?.role !== 'parent') fail('Родитель не найден в локальном реестре.')
  const directory = resolve('.local/mesh-connections')
  if (!existsSync(directory)) fail('Подключение МЭШ не найдено в локальном хранилище.')
  const files = readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
  const matching = files.map((name) => ({ name, record: read(join(directory, name), null) }))
    .filter(({ record }) => record?.parentPersonId === parentPersonId)
  if (!matching.length) fail('Подключение МЭШ не найдено в локальном хранилище.')
  for (const { name, record } of matching) {
    const accountRef = db.doc(`sourceAccounts/${sourceKey('mesh-parent', record.credentials.actorPersonId)}`)
    await accountRef.update({ disconnectedAt: Timestamp.now() })
    unlinkSync(join(directory, name))
  }
  console.log(`Удалено локальных подключений МЭШ: ${matching.length}. Опубликованные ранее данные и личные ссылки не удалены.`)
}

function validCredentials(data) {
  if (data?.schemaVersion !== 1 || data.source !== 'mesh' || !data.credentials || !Number.isFinite(Date.parse(data.issuedAt))) fail('Неверный состав зашифрованного пакета.')
  const c = data.credentials
  for (const key of ['token', 'clientId', 'clientSecret', 'actorPersonId', 'profileId', 'studentId']) {
    if (typeof c[key] !== 'string' || !c[key] || c[key].length > 8192) fail('Неполные полномочия МЭШ.')
  }
  if (c.refreshToken != null && (typeof c.refreshToken !== 'string' || c.refreshToken.length > 8192)) fail('Неверный токен обновления.')
  return c
}

async function receive(code) {
  if (!codePattern.test(code) || !invites.invites[code]) fail('Приглашение не найдено в локальном реестре.')
  const inviteRef = db.doc(`connectionInvites/${code}`)
  const handoffRef = inviteRef.collection('handoff').doc('current')
  const [inviteSnapshot, handoffSnapshot] = await Promise.all([inviteRef.get(), handoffRef.get()])
  const invite = inviteSnapshot.data()
  if (!invite || invite.status !== 'open' || !handoffSnapshot.exists) fail('Заявка не ожидает обработки.')
  if (!invite.expiresAt?.toMillis || invite.expiresAt.toMillis() <= Date.now()) {
    fail('Срок приглашения истёк. Создайте новое приглашение; прежняя заявка не подключает семью.')
  }
  const payload = decryptHandoff(code, invites.invites[code].privateKey, handoffSnapshot.data())
  let credentials = validCredentials(payload)
  const adapter = new MeshDiaryAdapter(credentials, (updated) => { credentials = updated })
  await adapter.verifyAccess()
  const [profiles, parent] = await Promise.all([
    adapter.api.getStudentProfiles(credentials.actorPersonId),
    adapter.api.getProfile(),
  ])
  if (parent?.profile?.type !== 'parent' || !Array.isArray(profiles) || !profiles.length || !Array.isArray(parent.children)) fail('Родительский профиль и дети не подтверждены МЭШ.')
  const available = profiles.filter((profile) => profile?.person_id && parent.children.some((child) => String(child.id) === String(profile.id)))
  if (available.length !== profiles.length || !available.length) fail('Не все дети подтверждены в профиле родителя.')

  const identityRefs = available.map((profile) => db.doc(`sourceIdentities/${sourceKey('mesh-child', profile.person_id)}`))
  const accountRef = db.doc(`sourceAccounts/${sourceKey('mesh-parent', credentials.actorPersonId)}`)
  const [identityDocs, accountDoc] = await Promise.all([
    Promise.all(identityRefs.map((ref) => ref.get())), accountRef.get(),
  ])
  const knownFamilies = new Set(identityDocs.filter((doc) => doc.exists).map((doc) => doc.data().familyId))
  if (accountDoc.exists) knownFamilies.add(accountDoc.data().familyId)
  if (knownFamilies.size > 1) fail('Дети или взрослый уже связаны с разными семьями; нужно разобрать вручную.')
  const targetFamilyId = invites.invites[code].targetFamilyId ?? null
  const linkedFamilyId = [...knownFamilies][0] ?? null
  if (targetFamilyId && linkedFamilyId && targetFamilyId !== linkedFamilyId) fail('Приглашение относится к другой семье.')
  if (targetFamilyId && !linkedFamilyId) fail('Для присоединения к семье нужен подтверждённый общий ребёнок МЭШ.')
  const familyId = targetFamilyId ?? linkedFamilyId ?? id()
  const isNewFamily = !families.families[familyId]
  if (linkedFamilyId && isNewFamily) fail('Семья есть в Firebase, но отсутствует в локальном реестре; нужна сверка.')
  const batch = db.batch()
  const now = Timestamp.now()
  const newChildren = []
  const childIds = []
  if (isNewFamily) batch.create(db.doc(`families/${familyId}`), { schemaVersion: 2, createdAt: now })
  for (let index = 0; index < available.length; index++) {
    const profile = available[index]
    const known = identityDocs[index].data()
    if (known && known.familyId !== familyId) fail('Профиль ребёнка относится к другой семье.')
    if (known) { childIds.push(known.childId); continue }
    const childId = id(), personId = id(), link = secret()
    const displayName = String(profile.user_name || profile.short_name || `Ученик ${index + 1}`).slice(0, 80)
    batch.create(db.doc(`families/${familyId}/children/${childId}`), { displayName, timezone: 'Europe/Moscow', meshPersonId: String(profile.person_id), libraryPolicyVersion: 1, createdAt: now })
    batch.create(db.doc(`users/${personId}`), { displayName, createdAt: now })
    batch.create(db.doc(`users/${personId}/families/${familyId}`), { createdAt: now })
    batch.create(db.doc(`families/${familyId}/members/${personId}`), { role: 'student', active: true, childIds: [childId], displayName, createdAt: now })
    batch.create(db.doc(`accessLinks/${link}`), { personId, active: true, createdAt: now })
    batch.create(identityRefs[index], { source: 'mesh', sourcePersonId: String(profile.person_id), familyId, childId, createdAt: now })
    newChildren.push({ childId, personId, link, displayName })
    childIds.push(childId)
  }
  const knownParentId = accountDoc.data()?.personId
  const parentPersonId = knownParentId ?? id()
  if (knownParentId) {
    batch.update(db.doc(`families/${familyId}/members/${knownParentId}`), { childIds: FieldValue.arrayUnion(...childIds), active: true, meshConnectedAt: now })
    batch.update(accountRef, { disconnectedAt: FieldValue.delete(), connectedAt: now })
  } else {
    const displayName = String(parent.profile.user_name || parent.profile.short_name || 'Взрослый МЭШ').slice(0, 80)
    const parentLink = secret()
    batch.create(db.doc(`users/${parentPersonId}`), { displayName, createdAt: now })
    batch.create(db.doc(`users/${parentPersonId}/families/${familyId}`), { createdAt: now })
    batch.create(db.doc(`families/${familyId}/members/${parentPersonId}`), { role: 'parent', active: true, childIds, displayName, inviteQuota: invites.invites[code].delegateQuota ?? 0, meshConnectedAt: now, createdAt: now })
    batch.create(db.doc(`accessLinks/${parentLink}`), { personId: parentPersonId, active: true, createdAt: now })
    batch.create(accountRef, { source: 'mesh', sourcePersonId: String(credentials.actorPersonId), familyId, personId: parentPersonId, createdAt: now })
    families.people[parentPersonId] = { familyId, role: 'parent', displayName }
    families.links[parentPersonId] = [parentLink]
    // A second adult receives the existing child's calendar shortcuts. The
    // underlying day, photos, attempts and reviews keep their original IDs.
    for (const childId of childIds) {
      for (const [existingId, existing] of Object.entries(families.people)) {
        if (existing.familyId !== familyId || existing.role !== 'parent' || existingId === parentPersonId) continue
        const shortcut = await db.doc(`users/${existingId}/families/${familyId}/shortcuts/${childId}`).get()
        if (!shortcut.exists) continue
        batch.set(db.doc(`users/${parentPersonId}/families/${familyId}/shortcuts/${childId}`), { ...shortcut.data(), updatedAt: now })
        break
      }
    }
  }
  if (newChildren.length && !isNewFamily) {
    for (const [personId, entry] of Object.entries(families.people)) {
      if (entry.familyId === familyId && entry.role === 'parent' && personId !== parentPersonId) {
        batch.update(db.doc(`families/${familyId}/members/${personId}`), { childIds: FieldValue.arrayUnion(...newChildren.map((child) => child.childId)) })
      }
    }
  }
  batch.update(inviteRef, { status: 'connected', connectedAt: now })
  batch.delete(handoffRef)
  const issuerPersonId = invites.invites[code].issuerPersonId
  if (issuerPersonId) batch.update(db.doc(`users/${issuerPersonId}/invites/${code}`), {
    status: 'connected', connectedAt: now, connectedFamilyId: familyId,
    connectedParentId: parentPersonId,
    connectedParentName: families.people[parentPersonId]?.displayName
      ?? String(parent.profile.user_name || parent.profile.short_name || 'Взрослый МЭШ').slice(0, 80),
  })
  if (issuerPersonId) batch.update(db.doc(`families/${invites.invites[code].issuerFamilyId}/invites/${code}`), {
    status: 'connected', connectedAt: now, connectedFamilyId: familyId,
    connectedParentId: parentPersonId,
    connectedParentName: families.people[parentPersonId]?.displayName
      ?? String(parent.profile.user_name || parent.profile.short_name || 'Взрослый МЭШ').slice(0, 80),
  })

  const accountKey = sourceKey('mesh-parent', credentials.actorPersonId)
  const secretDir = resolve('.local/mesh-connections')
  mkdirSync(secretDir, { recursive: true, mode: 0o700 })
  save(join(secretDir, `${accountKey}.json`), { familyId, parentPersonId, credentials })
  await batch.commit()
  families.families[familyId] ??= { childIds: [] }
  for (const child of newChildren) {
    families.families[familyId].childIds.push(child.childId)
    families.people[child.personId] = { familyId, childId: child.childId, role: 'student', displayName: child.displayName }
    families.links[child.personId] = [child.link]
  }
  save(familyFile, families)
  for (const childId of childIds) {
    try { await syncChildAccess(db, families, familyId, childId) }
    catch { console.warn('Личные ссылки ребёнка не отобразились в кабинете; повторите family:access sync для этой семьи.') }
  }
  delete invites.invites[code].privateKey
  invites.invites[code].familyId = familyId
  invites.invites[code].parentPersonId = parentPersonId
  save(inviteFile, invites)
  console.log(`МЭШ подключён. Семья: ${familyId}; взрослый: ${parentPersonId}; детей: ${childIds.length}.`)
  console.log('Личная ссылка взрослого хранится в закрытом реестре; получить её можно через npm run family -- link-url <personId>.')
}

async function seedCurrent(familyId, childId, parentPersonId) {
  if (!families.families[familyId]?.childIds.includes(childId)) fail('Ребёнок не принадлежит указанной семье.')
  if (families.people[parentPersonId]?.familyId !== familyId || families.people[parentPersonId]?.role !== 'parent') fail('Родитель не принадлежит указанной семье.')
  const saved = read(resolve('.local/diary/secret.json'), null)
  if (!saved) fail('Локальный доступ МЭШ не найден.')
  let credentials = saved
  const adapter = new MeshDiaryAdapter(credentials, (updated) => { credentials = updated })
  await adapter.verifyAccess()
  const childRef = db.doc(`sourceIdentities/${sourceKey('mesh-child', credentials.personId)}`)
  const actorPersonId = credentials.actorPersonId || credentials.personId
  const parentRef = db.doc(`sourceAccounts/${sourceKey('mesh-parent', actorPersonId)}`)
  const [child, parent] = await Promise.all([childRef.get(), parentRef.get()])
  if (child.exists && (child.data().familyId !== familyId || child.data().childId !== childId)) fail('Идентификатор МЭШ уже связан с другой семьёй или ребёнком.')
  if (parent.exists && (parent.data().familyId !== familyId || parent.data().personId !== parentPersonId)) fail('Учётная запись МЭШ уже связана с другим взрослым.')
  const now = Timestamp.now()
  const batch = db.batch()
  if (!child.exists) batch.create(childRef, { source: 'mesh', sourcePersonId: credentials.personId, familyId, childId, createdAt: now })
  if (!parent.exists) batch.create(parentRef, { source: 'mesh', sourcePersonId: actorPersonId, familyId, personId: parentPersonId, createdAt: now })
  batch.update(db.doc(`families/${familyId}/children/${childId}`), { meshPersonId: credentials.personId })
  batch.update(db.doc(`families/${familyId}/members/${parentPersonId}`), { meshConnectedAt: now, displayName: families.people[parentPersonId].displayName })
  await batch.commit()
  console.log('Текущие ребёнок и взрослый связаны с идентификаторами МЭШ; повторное подключение сохранит эту семью и профиль.')
}

const [command, ...args] = process.argv.slice(2)
try {
  if (command === 'issue') await issue(args)
  else if (command === 'list') await list()
  else if (command === 'revoke') await revoke(args[0])
  else if (command === 'process-requests') await processRequests(args[0])
  else if (command === 'process-revocations') await processRevocations(args[0])
  else if (command === 'promote-current-parent') await promoteCurrentParent(args[0])
  else if (command === 'disconnect') await disconnect(args[0])
  else if (command === 'receive') await receive(args[0])
  else if (command === 'seed-current') await seedCurrent(args[0], args[1], args[2])
  else fail('Команды: issue [--family id] [--issuer id] [--days 7] [--delegates 0]; list; revoke <код>; process-requests <personId>; process-revocations <personId>; promote-current-parent <personId>; receive <код>; disconnect <personId>; seed-current <familyId> <childId> <personId>.')
} catch (error) {
  const message = String(error?.message || '')
  const safe = /^(Семья не найдена|Срок:|Создатель приглашения|У взрослого нет права|Приглашение в другую семью|Взрослый не найден|Заявка на приглашение|Начальный взрослый|Действующая семейная связь|Приглашение не найдено|Можно отозвать|Подключение МЭШ не найдено|Родитель не найден|Заявка не ожидает|Неверный состав|Неполные полномочия|Неверный токен|Родительский профиль|Не все дети|Дети или взрослый|Приглашение относится|Для присоединения|Семья есть|Профиль ребёнка|Ребёнок не принадлежит|Родитель не принадлежит|Локальный доступ|Идентификатор МЭШ|Учётная запись МЭШ|Команды:)/.test(message)
  console.error(safe ? message : 'Операция не завершена. Проверьте локальный доступ и состояние заявки.')
  process.exitCode = 1
}
