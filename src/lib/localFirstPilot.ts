/** Isolated v2 protocol pilot. It never connects to production Firebase.
 * @see ../../docs/services/web-app/local-first-sync.md#decision
 * @see ../../docs/services/web-app/local-first-verification.md#contract */
/** A role plus its person/child scope; two pupils in one family never share a local namespace. */
export type Audience = `parent:${string}` | `student:${string}`
export type Channel = 'calendar' | 'tasks' | 'materials' | 'submissions' | 'quizzes' | 'reviews' | 'guidance' | 'access'
export type Entries = Record<string, unknown>
export type Revisions = Partial<Record<Channel, number>>
export type Head = { schemaVersion: 2; familyId: string; audience: Audience; epoch: string; revisions: Revisions }
export type Operation = { kind: 'put'; key: string; value: unknown } | { kind: 'delete'; key: string }
export type Packet = { schemaVersion: 2; familyId: string; audience: Audience; epoch: string; channel: Channel;
  previousRevision: number; revision: number; operations: Operation[]; checksum: string }
export type ChannelSnapshot = { schemaVersion: 2; familyId: string; audience: Audience; epoch: string; channel: Channel;
  revision: number; entries: Entries; checksum: string }
export type Projection = { namespace: string; schemaVersion: 2; familyId: string; audience: Audience; epoch: string;
  revisions: Revisions; channels: Partial<Record<Channel, Entries>>; legacyDashboard?: unknown }
export type DeltaSource = {
  getHead(familyId: string, audience: Audience): Promise<Head>
  getPacket(familyId: string, audience: Audience, epoch: string, channel: Channel, revision: number): Promise<Packet | null>
  getSnapshot(familyId: string, audience: Audience, epoch: string, channel: Channel, revision: number): Promise<ChannelSnapshot | null>
}

const databaseName = 'education-projection-pilot-v2'
const storeName = 'projections'
const channels: Channel[] = ['access', 'calendar', 'tasks', 'materials', 'submissions', 'quizzes', 'reviews', 'guidance']
const namespace = (familyId: string, audience: Audience) => JSON.stringify([familyId, audience])
const safeKey = (key: unknown): key is string => typeof key === 'string' && !!key
  && !['__proto__', 'constructor', 'prototype'].includes(key)

function stable(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]))
  }
  throw new Error('Пакет содержит значение вне JSON-контракта.')
}

async function checksum(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(stable(value)))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function makePacket(input: Omit<Packet, 'checksum'>): Promise<Packet> {
  return { ...input, checksum: await checksum(input) }
}
export async function makeSnapshot(input: Omit<ChannelSnapshot, 'checksum'>): Promise<ChannelSnapshot> {
  return { ...input, checksum: await checksum(input) }
}

function validHead(head: Head, familyId: string, audience: Audience) {
  return head?.schemaVersion === 2 && head.familyId === familyId && head.audience === audience
    && /^(parent|student):[a-zA-Z0-9_-]+$/.test(head.audience) && !!head.epoch
    && head.revisions && typeof head.revisions === 'object' && Object.entries(head.revisions).every(([channel, revision]) =>
      channels.includes(channel as Channel) && Number.isSafeInteger(revision) && revision >= 0)
}
async function validPacket(packet: Packet | null, head: Head, channel: Channel, previousRevision: number) {
  if (!packet || packet.schemaVersion !== 2 || packet.familyId !== head.familyId || packet.audience !== head.audience
    || packet.epoch !== head.epoch || packet.channel !== channel || packet.previousRevision !== previousRevision
    || packet.revision !== previousRevision + 1 || !Array.isArray(packet.operations)
    || packet.operations.some((op) => !op || !['put', 'delete'].includes(op.kind) || !safeKey(op.key))) return false
  const { checksum: expected, ...payload } = packet
  return expected === await checksum(payload)
}
async function validSnapshot(snapshot: ChannelSnapshot | null, head: Head, channel: Channel, revision: number) {
  if (!snapshot || snapshot.schemaVersion !== 2 || snapshot.familyId !== head.familyId || snapshot.audience !== head.audience
    || snapshot.epoch !== head.epoch || snapshot.channel !== channel || snapshot.revision !== revision
    || !snapshot.entries || typeof snapshot.entries !== 'object' || Array.isArray(snapshot.entries)
    || Object.keys(snapshot.entries).some((key) => !safeKey(key))) return false
  const { checksum: expected, ...payload } = snapshot
  return expected === await checksum(payload)
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'namespace' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Локальная проекция занята другой вкладкой.'))
  })
}

export async function readProjection(familyId: string, audience: Audience): Promise<Projection | null> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).get(namespace(familyId, audience))
    tx.oncomplete = () => { database.close(); resolve(request.result ?? null) }
    tx.onerror = () => { database.close(); reject(tx.error) }
    tx.onabort = () => { database.close(); reject(tx.error) }
  })
}

async function commitProjection(previous: Projection | null, next: Projection | null, familyId: string, audience: Audience): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const key = namespace(familyId, audience)
    const request = store.get(key)
    request.onsuccess = () => {
      const current = request.result as Projection | undefined
      if (JSON.stringify([current?.epoch, current?.revisions]) !== JSON.stringify([previous?.epoch, previous?.revisions])) {
        tx.abort(); return
      }
      if (next) store.put(next)
      else store.delete(key)
    }
    tx.oncomplete = () => { database.close(); resolve() }
    tx.onerror = () => { database.close(); reject(tx.error) }
    tx.onabort = () => { database.close(); reject(new Error('Локальная проекция изменилась во время синхронизации; повторите получение head.')) }
  })
}

/** Additive local import: the legacy dashboard and existing quiz-draft database are untouched. */
export async function importLegacyDashboard(familyId: string, audience: Audience, dashboard: unknown): Promise<void> {
  const previous = await readProjection(familyId, audience)
  if (previous) return
  await commitProjection(null, { namespace: namespace(familyId, audience), schemaVersion: 2, familyId, audience,
    epoch: 'legacy', revisions: { calendar: 0 }, channels: { calendar: { dashboard } }, legacyDashboard: dashboard }, familyId, audience)
}

export async function clearProjection(familyId: string, audience: Audience): Promise<void> {
  const previous = await readProjection(familyId, audience)
  if (previous) await commitProjection(previous, null, familyId, audience)
}

/** Head and changed channels are read from an injected source. All changed channels commit together. */
export async function synchronizeProjection(source: DeltaSource, familyId: string, audience: Audience): Promise<{ changed: Channel[]; status: 'unchanged' | 'updated' | 'revoked' }> {
  let head: Head
  try { head = await source.getHead(familyId, audience) }
  catch (error) {
    if ((error as { code?: string }).code === 'permission-denied') { await clearProjection(familyId, audience); return { changed: [], status: 'revoked' } }
    throw error
  }
  if (!validHead(head, familyId, audience)) throw new Error('Несовместимый или чужой семейный head.')
  const previous = await readProjection(familyId, audience)
  const reset = previous?.epoch !== head.epoch
  const changed = channels.filter((channel) => head.revisions[channel] !== undefined
    && (reset || (previous?.revisions[channel] ?? -1) !== head.revisions[channel]))
  if (!reset && !changed.length) return { changed: [], status: 'unchanged' }
  if (!reset && changed.some((channel) => (head.revisions[channel] ?? 0) < (previous?.revisions[channel] ?? 0))) {
    throw new Error('Ревизия уменьшилась без смены эпохи.')
  }
  const updates = await Promise.all(changed.map(async (channel) => {
    const target = head.revisions[channel]!
    let entries: Entries | null = reset ? null : { ...previous?.channels[channel] }
    if (entries) {
      for (let revision = (previous?.revisions[channel] ?? 0) + 1; revision <= target; revision++) {
        const packet = await source.getPacket(familyId, audience, head.epoch, channel, revision)
        if (!await validPacket(packet, head, channel, revision - 1)) { entries = null; break }
        for (const operation of packet!.operations) {
          if (operation.kind === 'put') entries[operation.key] = operation.value
          else delete entries[operation.key]
        }
      }
    }
    if (!entries) {
      const snapshot = await source.getSnapshot(familyId, audience, head.epoch, channel, target)
      if (!await validSnapshot(snapshot, head, channel, target)) throw new Error(`Нет целостного снимка канала ${channel}.`)
      entries = snapshot!.entries
    }
    return [channel, entries] as const
  }))
  const next: Projection = { namespace: namespace(familyId, audience), schemaVersion: 2, familyId, audience,
    epoch: head.epoch, revisions: { ...head.revisions }, channels: reset ? {} : { ...previous?.channels },
    ...(previous?.legacyDashboard === undefined ? {} : { legacyDashboard: previous.legacyDashboard }) }
  for (const [channel, entries] of updates) next.channels[channel] = entries
  await commitProjection(previous, next, familyId, audience)
  return { changed, status: 'updated' }
}
