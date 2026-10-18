import { describe, expect, it } from 'vitest'
import { inspectTelegramReadiness } from './readiness.mjs'
import { main } from '../../../scripts/telegram-runtime.mjs'

const secret = '987654321:NEVER_INCLUDE_TOKEN_IN_OUTPUT'

function fakeDb({ accounts = [], links = [], members = {}, telegramAccounts = {}, outboxFailure = null, groupFailure = null } = {}) {
  const db = {
    collection(name) {
      if (name === 'telegramNotificationOutbox') {
        let isGroup = false
        const query = { where(field) { if (field === 'groupId') isGroup = true; return query }, orderBy() { return query }, limit() { return query },
          async get() { if (outboxFailure) throw outboxFailure; if (isGroup && groupFailure) throw groupFailure; return { size: 0, docs: [] } } }
        return query
      }
      const rows = name === 'telegramBotAccounts' ? accounts : name === 'telegramBotFamilyLinks' ? links : []
      const query = {
        async get() { return { size: rows.length, docs: rows.map((data, index) => ({ id: String(index), data: () => data })) } },
        count() { return { async get() { return { data: () => ({ count: rows.length }) } } } },
        where(field, op, expected) {
          const filtered = rows.filter((row) => op === '==' && row[field] === expected)
          return { async get() { return { size: filtered.length, docs: filtered.map((data, index) => ({ id: String(index), data: () => data })) } } }
        },
      }
      return query
    },
    doc(path) { return { async get() { const data = telegramAccounts[path] ?? members[path]; return { exists: Boolean(data), data: () => data } } } },
  }
  return db
}
function fakeFs() {
  const files = new Map([['/repo/.firebaserc', JSON.stringify({ projects: { default: 'education-9d7c6' } })],
    ['/repo/.local/adc.json', 'private']])
  const directories = new Set(['/repo/.local/mesh-connections'])
  return {
    existsSync(path) { return files.has(path) || directories.has(path) || path === '/repo/agent.plist' },
    readFileSync(path) { if (!files.has(path)) throw new Error('missing'); return files.get(path) },
    readdirSync(path) { return path === '/repo/.local/mesh-connections' ? ['a'.repeat(64) + '.json', 'notes.txt'] : [] },
  }
}

describe('Telegram readiness inventory', () => {
  it('checks the actual group query even when claim and recovery indexes work', async () => {
    const result = await inspectTelegramReadiness({ root: '/repo', env: { AGI_EDU_BOT: secret }, fs: fakeFs(),
      db: fakeDb({ groupFailure: Object.assign(new Error('index required private-url'), { code: 'failed-precondition' }) }) })
    expect(result.outbox).toMatchObject({ claimQueryReady: true, recoveryQueryReady: true, groupQueryReady: false })
    expect(result.readyForDelivery).toBe(false)
    expect(JSON.stringify(result)).not.toContain('private-url')
  })

  it('counts active links only when a current parent membership authorizes children', async () => {
    const db = fakeDb({ accounts: [{ telegramUserId: '12345', username: 'private-name' }], links: [
      { familyId: 'family-a', personId: 'parent-a', telegramUserId: '12345', status: 'active' },
      { familyId: 'family-b', personId: 'parent-b', telegramUserId: '12346', status: 'active' },
      { familyId: 'family-c', personId: 'parent-c', telegramUserId: '12347', status: 'disconnected' },
    ], telegramAccounts: {
      'telegramBotAccounts/12345': { status: 'registered' },
      'telegramBotAccounts/12346': { status: 'registered', channelStatus: 'blocked' },
      'families/family-a': { active: true },
      'families/family-a/children/child-a': { active: true },
    }, members: {
      'families/family-a/members/parent-a': { active: true, role: 'parent', childIds: ['child-a'] },
      'families/family-b/members/parent-b': { active: false, role: 'parent', childIds: ['child-b'] },
    } })
    const result = await inspectTelegramReadiness({ root: '/repo', env: { AGI_EDU_BOT: secret }, fs: fakeFs(), db,
      launchAgentPath: '/repo/no-plist' })
    expect(result.projectId).toBe('education-9d7c6')
    expect(result.firestore).toEqual({ reachable: true, registeredTelegramAccounts: 1, activeAuthorizedLinks: 1 })
    expect(result.credentials.canonicalMesh.accountCount).toBe(1)
    expect(result.credentials.canonicalMesh.accountDigests).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain('private-name')
    expect(JSON.stringify(result)).not.toContain('12345')
  })

  it('reports legacy credentials as unverified and does not claim delivery readiness', async () => {
    const fs = fakeFs()
    fs.existsSync = (path) => path === '/repo/.firebaserc' || path === '/repo/.local/adc.json' || path === '/repo/.local/diary'
    const result = await inspectTelegramReadiness({ root: '/repo', env: { AGI_EDU_BOT: secret }, fs,
      db: fakeDb(), legacyDirectory: '.local/diary', launchAgentPath: '/repo/no-plist' })
    expect(result.credentials.legacyMesh).toEqual({ directoryAvailable: true, explicitlyVerified: false, accountCount: 0 })
    expect(result.readyForDelivery).toBe(false)
    expect(result.blockers).toContain('legacy_mesh_credentials_not_verified')
    expect(result.blockers).toContain('no_active_authorized_telegram_links')
  })

  it('prints only the privacy-safe readiness summary and exits successfully when blocked', async () => {
    let output = ''
    const code = await main(['readiness'], { root: '/repo', env: { AGI_EDU_BOT: secret }, fs: fakeFs(),
      db: fakeDb(), launchAgentPath: '/repo/no-plist', write: (chunk) => { output += chunk } })
    expect(code).toBe(0)
    expect(output).toContain('activeAuthorizedLinks')
    expect(output).not.toContain(secret)
    expect(output).not.toContain('private-name')
  })

  it('requires both loaded runtime and successful read-only outbox query preflights', async () => {
    const result = await inspectTelegramReadiness({ root: '/repo', env: { AGI_EDU_BOT: secret }, fs: fakeFs(), db: fakeDb({
      accounts: [{ telegramUserId: '12345' }], links: [{ familyId: 'family-a', personId: 'parent-a', telegramUserId: '12345', status: 'active' }],
      telegramAccounts: { 'telegramBotAccounts/12345': { status: 'registered' }, 'families/family-a': { active: true },
        'families/family-a/children/child-a': { active: true } },
      members: { 'families/family-a/members/parent-a': { active: true, role: 'parent', childIds: ['child-a'] } },
      outboxFailure: Object.assign(new Error('create private index at secret-url'), { code: 'failed-precondition' }),
    }), launchAgentPath: '/repo/agent.plist', launchAgentStatus: { installed: true, loaded: false, running: false, state: 'exited', lastExitCode: 2 } })
    expect(result.runtime).toMatchObject({ launchAgentInstalled: true, loaded: false, running: false, state: 'exited', lastExitCode: 2 })
    expect(result.outbox).toMatchObject({ claimQueryReady: false, recoveryQueryReady: false,
      blockedReasons: ['firestore_outbox_index_required', 'firestore_outbox_index_required', 'firestore_outbox_index_required'] })
    expect(result.readyForDelivery).toBe(false)
    expect(JSON.stringify(result)).not.toContain('secret-url')
    expect(result.blockers).toContain('persistent_runtime_not_running')
  })
})
