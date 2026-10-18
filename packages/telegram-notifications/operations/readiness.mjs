import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

/** @see ../../../docs/services/telegram-bot/operations.md */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

/** Read-only, privacy-safe deployment inventory. Firestore records are reduced to counts. */
export async function inspectTelegramReadiness({ root = process.cwd(), env = process.env, db = null,
  fs = defaultFs, projectFile = '.firebaserc', meshDirectory = '.local/mesh-connections',
  legacyDirectory = '.local/diary', launchAgentPath = defaultLaunchAgentPath(), launchAgentStatus = null,
  resolveLegacyOwner = null, linkIssuerAvailable = true } = {}) {
  const projectId = readDefaultProject(join(root, projectFile), fs)
  const explicitAdc = typeof env.GOOGLE_APPLICATION_CREDENTIALS === 'string' && env.GOOGLE_APPLICATION_CREDENTIALS.trim()
    ? resolve(env.GOOGLE_APPLICATION_CREDENTIALS) : null
  const localAdc = resolve(root, '.local/adc.json')
  const adcPath = explicitAdc && fs.existsSync(explicitAdc) ? explicitAdc : fs.existsSync(localAdc) ? localAdc : null
  const meshPath = resolve(root, meshDirectory)
  const legacyPath = resolve(root, legacyDirectory)
  const meshAccounts = listCanonicalMeshAccounts(meshPath, fs)
  const legacyPresent = fs.existsSync(legacyPath)
  const launchAgentInstalled = Boolean(launchAgentPath && fs.existsSync(launchAgentPath))
  const runtimeStatus = launchAgentStatus ?? { installed: launchAgentInstalled, loaded: false, running: false, state: 'unknown' }
  let explicitlyVerified = false
  if (legacyPresent && typeof resolveLegacyOwner === 'function') {
    try { explicitlyVerified = Boolean(await resolveLegacyOwner()) } catch { explicitlyVerified = false }
  }
  const result = {
    schemaVersion: 1,
    projectId,
    tokenAvailable: Boolean(typeof env.AGI_EDU_BOT === 'string' && env.AGI_EDU_BOT.trim())
      || privateTokenFileAvailable(env.TELEGRAM_TOKEN_FILE, fs),
    firestore: { reachable: false, registeredTelegramAccounts: null, activeAuthorizedLinks: null },
    activeLinkDigests: [],
    credentials: {
      applicationDefaultCredentialsAvailable: Boolean(adcPath),
      applicationDefaultCredentialsSource: explicitAdc && adcPath === explicitAdc ? 'configured_path' : adcPath ? 'local_adc' : 'missing',
      canonicalMesh: { directoryAvailable: fs.existsSync(meshPath), accountCount: meshAccounts.length,
        accountDigests: meshAccounts.map((name) => createHash('sha256').update(name.slice(0, -5)).digest('hex').slice(0, 16)) },
      legacyMesh: { directoryAvailable: legacyPresent, explicitlyVerified, accountCount: explicitlyVerified ? 1 : 0 },
    },
    runtime: { launchAgentInstalled, loaded: runtimeStatus.loaded === true, running: runtimeStatus.running === true,
      state: safeLaunchState(runtimeStatus.state), ...(Number.isSafeInteger(runtimeStatus.lastExitCode) ? { lastExitCode: runtimeStatus.lastExitCode } : {}) },
    linkIssuerAvailable: linkIssuerAvailable === true,
    outbox: { claimQueryReady: null, recoveryQueryReady: null, groupQueryReady: null, blockedReasons: [] },
    readyForDelivery: false,
    blockers: [],
  }
  if (!projectId) result.blockers.push('firebase_project_unavailable')
  if (!result.tokenAvailable) result.blockers.push('telegram_token_unavailable')
  if (!result.credentials.applicationDefaultCredentialsAvailable) result.blockers.push('application_default_credentials_unavailable')
  if (meshAccounts.length === 0 && !explicitlyVerified) result.blockers.push('mesh_credentials_unavailable')
  if (legacyPresent && !explicitlyVerified) result.blockers.push('legacy_mesh_credentials_not_verified')
  if (!launchAgentInstalled) result.blockers.push('persistent_runtime_not_installed')
  else if (runtimeStatus.loaded !== true || runtimeStatus.running !== true) result.blockers.push('persistent_runtime_not_running')
  if (!linkIssuerAvailable) result.blockers.push('trusted_link_issuer_unavailable')
  if (!db || !projectId) {
    result.blockers.push('firestore_not_checked')
    return result
  }
  try {
    const accountCount = await countDocuments(db.collection('telegramBotAccounts'))
    result.outbox = await inspectOutboxQueries(db)
    const activeLinks = await db.collection('telegramBotFamilyLinks').where('status', '==', 'active').get()
    let activeAuthorizedLinks = 0
    const activeLinkDigests = []
    for (const doc of activeLinks.docs) {
      const link = doc.data()
      if (!validLink(link)) continue
      const [account, member] = await Promise.all([
        db.doc(`telegramBotAccounts/${link.telegramUserId}`).get(),
        db.doc(`families/${link.familyId}/members/${link.personId}`).get(),
      ])
      if (!account.exists || !member.exists) continue
      const accountRow = account.data()
      const memberRow = member.data()
      const channelStatus = accountRow?.channelStatus ?? 'available'
      if (accountRow?.status === 'disconnected' || channelStatus !== 'available'
        || memberRow?.active !== true || memberRow.role !== 'parent' || !Array.isArray(memberRow.childIds)) continue
      const family = await db.doc(`families/${link.familyId}`).get()
      if (!family.exists || family.data()?.active === false) continue
      const activeChild = await firstActiveChild(db, link.familyId, memberRow.childIds)
      if (activeChild) {
        activeAuthorizedLinks += 1
        activeLinkDigests.push(createHash('sha256').update(doc.id).digest('hex').slice(0, 16))
      }
    }
    result.firestore = { reachable: true, registeredTelegramAccounts: accountCount, activeAuthorizedLinks }
    result.activeLinkDigests = [...new Set(activeLinkDigests)].sort()
  } catch {
    result.blockers.push('firestore_readiness_unavailable')
  }
  if (!result.firestore.reachable) return result
  result.blockers.push(...result.outbox.blockedReasons)
  result.readyForDelivery = result.tokenAvailable && result.credentials.applicationDefaultCredentialsAvailable
    && (meshAccounts.length > 0 || explicitlyVerified)
    && result.firestore.activeAuthorizedLinks > 0 && launchAgentInstalled && runtimeStatus.loaded === true
    && runtimeStatus.running === true && result.outbox.claimQueryReady === true && result.outbox.recoveryQueryReady === true && result.outbox.groupQueryReady === true
    && result.blockers.length === 0
  if (result.firestore.activeAuthorizedLinks === 0) result.blockers.push('no_active_authorized_telegram_links')
  if (!result.readyForDelivery && !result.blockers.length) result.blockers.push('trusted_link_issuer_unavailable')
  return result
}

async function inspectOutboxQueries(db) {
  const result = { claimQueryReady: false, recoveryQueryReady: false, groupQueryReady: false, blockedReasons: [] }
  const now = new Date().toISOString()
  try {
    await db.collection('telegramNotificationOutbox').where('state', 'in', ['pending', 'retry_wait'])
      .where('nextAttemptAt', '<=', now).orderBy('nextAttemptAt').limit(1).get()
    result.claimQueryReady = true
  } catch (error) { result.blockedReasons.push(classifyQueryFailure(error)) }
  try {
    await db.collection('telegramNotificationOutbox').where('state', '==', 'leased')
      .where('leaseUntil', '<=', now).limit(1).get()
    result.recoveryQueryReady = true
  } catch (error) { result.blockedReasons.push(classifyQueryFailure(error)) }
  try {
    await db.collection('telegramNotificationOutbox').where('groupId', '==', 'readiness-only-nonexistent-group')
      .where('state', '==', 'pending').limit(1).get()
    result.groupQueryReady = true
  } catch (error) { result.blockedReasons.push(classifyQueryFailure(error)) }
  return result
}

function classifyQueryFailure(error) {
  if (error?.code === 'permission-denied' || error?.code === 7) return 'firestore_outbox_permission_denied'
  if (error?.code === 'failed-precondition' || error?.code === 9) {
    const text = String(error?.message ?? '').toLowerCase()
    return /index|required.*index|index.*required/.test(text) ? 'firestore_outbox_index_required' : 'firestore_outbox_query_failed_precondition'
  }
  return 'firestore_outbox_query_unavailable'
}

function safeLaunchState(value) {
  return ['running', 'waiting', 'exited', 'spawn scheduled', 'throttled', 'unknown', 'not_running'].includes(value) ? value : 'unknown'
}

function readDefaultProject(path, fs) {
  try {
    const value = JSON.parse(fs.readFileSync(path, 'utf8'))?.projects?.default
    return typeof value === 'string' && /^[a-z][a-z0-9-]{4,62}$/.test(value) ? value : null
  } catch { return null }
}

async function countDocuments(collection) {
  if (typeof collection.count === 'function') {
    const aggregate = await collection.count().get()
    return aggregate.data().count
  }
  const snapshot = await collection.get()
  return snapshot.size ?? snapshot.docs.length
}

async function firstActiveChild(db, familyId, childIds) {
  for (const childId of [...new Set(childIds.filter(validId))].sort()) {
    const child = await db.doc(`families/${familyId}/children/${childId}`).get()
    if (child.exists && child.data()?.active !== false) return childId
  }
  return null
}

function listCanonicalMeshAccounts(path, fs) {
  try {
    return fs.readdirSync(path).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort()
  } catch { return [] }
}

function privateTokenFileAvailable(path, fs) {
  if (typeof path !== 'string' || !path.trim()) return false
  try {
    const info = fs.statSync(path)
    return info.isFile() && (info.mode & 0o077) === 0
      && (typeof process.getuid !== 'function' || info.uid === process.getuid())
  } catch { return false }
}

function validLink(link) {
  return link && typeof link.familyId === 'string' && SAFE_ID.test(link.familyId)
    && typeof link.personId === 'string' && SAFE_ID.test(link.personId)
    && typeof link.telegramUserId === 'string' && /^\d{5,}$/.test(link.telegramUserId)
}
function validId(value) { return typeof value === 'string' && SAFE_ID.test(value) }
function defaultLaunchAgentPath() {
  if (process.platform !== 'darwin') return null
  return join(process.env.HOME ?? '', 'Library/LaunchAgents/com.petr.education.telegram-worker.plist')
}
const defaultFs = { existsSync, readFileSync, readdirSync, statSync }
