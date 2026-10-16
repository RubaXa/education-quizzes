import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'

const checksum = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Durable operator projection for one append/update-only source. Client rules
 * require requestedAt == request.time and forbid deletes; a periodic full pass
 * also catches privileged out-of-band edits and damaged local state.
 * @see ../docs/plans/local-first-release-plan-2026-10-12.md
 */
export class HelpRequestCache {
  constructor(file, Timestamp, { now = () => Date.now(), fullAuditMs = 24 * 60 * 60 * 1000 } = {}) {
    this.file = file
    this.Timestamp = Timestamp
    this.now = now
    this.fullAuditMs = fullAuditMs
    this.owners = Object.create(null)
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      if (saved.version === 1 && saved.owners && typeof saved.owners === 'object' && !Array.isArray(saved.owners)
        && saved.checksum === checksum(saved.owners)) {
        this.owners = Object.assign(Object.create(null), saved.owners)
      }
    } catch { /* First run or damaged cache is a full source scan. */ }
  }

  async read(ownerId, collection) {
    if (!/^[a-zA-Z0-9_-]+$/.test(ownerId)) throw new Error('Некорректный владелец обращений за помощью.')
    const old = this.owners[ownerId]
    const age = old ? this.now() - old.fullAt : NaN
    const fresh = old && Number.isFinite(old.fullAt) && age >= 0 && age < this.fullAuditMs
      && old.entries && typeof old.entries === 'object' && !Array.isArray(old.entries)
      && Object.values(old.entries).every((item) => item && item.requestedAt
        && Number.isInteger(item.requestedAt.seconds) && Number.isInteger(item.requestedAt.nanoseconds))
    const latest = fresh ? Object.values(old.entries).map((item) => item?.requestedAt)
      .filter((stamp) => Number.isInteger(stamp?.seconds) && Number.isInteger(stamp?.nanoseconds))
      .sort((a, b) => b.seconds - a.seconds || b.nanoseconds - a.nanoseconds)[0] : null
    // Re-read the boundary timestamp: distinct requests can have equal server times.
    const query = fresh && latest ? collection.where('requestedAt', '>=', new this.Timestamp(latest.seconds, latest.nanoseconds)) : collection
    const snapshot = await query.get()
    const entries = fresh ? { ...old.entries } : {}
    let indexable = true
    for (const doc of snapshot.docs) {
      if (!/^[a-zA-Z0-9_-]+$/.test(doc.id)) throw new Error('Некорректный ID обращения за помощью.')
      const data = doc.data()
      const stamp = data.requestedAt
      if (!Number.isInteger(stamp?.seconds) || !Number.isInteger(stamp?.nanoseconds)) indexable = false
      entries[doc.id] = {
        revision: Number.isInteger(data.revision) ? data.revision : null,
        requestKind: typeof data.requestKind === 'string' ? data.requestKind : null,
        requestedAt: stamp && Number.isInteger(stamp.seconds) && Number.isInteger(stamp.nanoseconds)
          ? { seconds: stamp.seconds, nanoseconds: stamp.nanoseconds } : null,
      }
    }
    // A malformed Admin write cannot establish a safe cursor. Revisit it in a full pass.
    this.owners[ownerId] = { fullAt: fresh && indexable ? old.fullAt : indexable ? this.now() : 0, entries }
    return { mode: fresh && latest ? 'delta' : 'full', fetched: snapshot.size,
      docs: Object.entries(entries).map(([id, item]) => ({ id, data: () => ({ ...item,
        requestedAt: item.requestedAt ? new this.Timestamp(item.requestedAt.seconds, item.requestedAt.nanoseconds) : null }) })) }
  }

  retainOwners(ownerIds) {
    const live = new Set(ownerIds)
    for (const ownerId of Object.keys(this.owners)) if (!live.has(ownerId)) delete this.owners[ownerId]
  }

  save() {
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify({ version: 1, owners: this.owners, checksum: checksum(this.owners) }), { mode: 0o600 })
    renameSync(temporary, this.file)
  }
}
