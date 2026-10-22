import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { audioLink, audioSourceUrl, bindingErrors, collectionId, digest, discoverAudio, starlightSource, verifyAudio } from '../storage/audio-library.mjs'

/** Repeatable operator path; no background worker or learner data in catalogue.
 * @see ../docs/modules/materials/audio-library.md#sync */
const [command, argument] = process.argv.slice(2)
const local = resolve('.local')
const folder = resolve(local, 'audio-library')
const manifestFile = resolve(folder, `${collectionId}.json`)
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const save = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
const refresh = process.argv.includes('--refresh')
mkdirSync(folder, { recursive: true, mode: 0o700 })

async function download(url, limit) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(45_000) })
  if (!response.ok || Number(response.headers.get('content-length')) > limit) throw new Error(`Источник аудио: HTTP ${response.status} или превышен размер.`)
  const chunks = []; let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > limit) { await response.body.cancel().catch(() => {}); throw new Error('Превышен размер источника аудио.') }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
function firestore() {
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||= resolve(local, 'adc.json')
  initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
  return getFirestore()
}
async function writeVerified(ref, value) {
  const current = (await ref.get()).data()
  if (JSON.stringify(sort(current)) === JSON.stringify(sort(value))) return false
  await ref.set(value)
  const after = (await ref.get()).data()
  if (JSON.stringify(after) !== JSON.stringify(value)) {
    // Firestore does not preserve map property order.
    if (digest(JSON.stringify(sort(after))) !== digest(JSON.stringify(sort(value)))) throw new Error('Обратное чтение аудиокаталога не совпало.')
  }
  return true
}
function sort(value) {
  if (Array.isArray(value)) return value.map(sort)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sort(v)]))
  return value
}

if (command === 'discover') {
  const tracks = discoverAudio((await download(starlightSource, 1024 * 1024)).toString('utf8'))
  const previous = existsSync(manifestFile) ? read(manifestFile) : { tracks: [] }
  const old = new Map(previous.tracks.map((track) => [track.id, track]))
  const manifest = { collectionId, sourceUrl: starlightSource, title: 'Starlight 6 · аудиозаписи',
    tracks: tracks.map((track) => ({ ...(old.get(track.id)?.sourceUrl === track.sourceUrl ? old.get(track.id) : {}), ...track })) }
  save(manifestFile, manifest)
  console.log(JSON.stringify({ collectionId, tracks: tracks.length, sections: Object.fromEntries(['sb', 'wb', 'test'].map((kind) => [kind, tracks.filter((track) => track.kind === kind).length])) }))
} else if (command === 'sync') {
  const manifest = read(manifestFile)
  if (manifest.collectionId !== collectionId || manifest.sourceUrl !== starlightSource || !manifest.tracks?.length) throw new Error('Сначала выполните audio discover.')
  const disk = new YandexDiskStorage(readFileSync(resolve(local, 'yandex-disk-token'), 'utf8').trim())
  const db = firestore()
  let uploaded = 0, objectsWritten = 0
  // Sequential persistence makes every successful transfer resumable after failure.
  const selected = argument && !argument.startsWith('--') ? manifest.tracks.filter((track) => track.id === argument) : manifest.tracks
  if (!selected.length) throw new Error('Не найдена выбранная аудиозапись.')
  for (const track of selected) {
    if (!/^starlight-6-(?:\d+-\d+|wb-\d+|test-\d+)$/.test(track.id)) throw new Error('Некорректный ID аудиозаписи.')
    audioSourceUrl(track.sourceUrl)
    const cache = resolve(folder, `${track.id}.mp3`)
    const bytes = existsSync(cache) && !refresh ? readFileSync(cache) : await download(track.sourceUrl, 30 * 1024 * 1024)
    const hashes = verifyAudio(bytes)
    if (track.sha256 && !refresh && track.sha256 !== hashes.sha256) throw new Error('Локальный оригинал изменён; нужен явный --refresh.')
    writeFileSync(cache, bytes, { mode: 0o600 })
    const path = `app:/PETR/Аудио/${hashes.sha256}.mp3`
    const remote = await disk.putAt(path, bytes, hashes.md5)
    const url = await disk.publish(path)
    const object = { sha256: hashes.sha256, contentType: 'audio/mpeg', size: hashes.size,
      storage: { provider: 'yandex-disk', path: remote.path, md5: remote.md5 }, publicUrl: url }
    const objectRef = db.doc(`storedObjects/${hashes.sha256}`)
    const known = (await objectRef.get()).data()
    if (known && (known.size !== object.size || known.storage?.md5 && known.storage.md5 !== hashes.md5)) throw new Error('Конфликт общего объекта аудио.')
    if (!known) { await writeVerified(objectRef, object); objectsWritten += 1 }
    Object.assign(track, hashes, { url, diskPath: path })
    save(manifestFile, manifest)
    uploaded += 1
    console.error(JSON.stringify({ processed: uploaded, total: selected.length, id: track.id }))
  }
  if (manifest.tracks.some((track) => !track.sha256 || !track.url)) throw new Error('Передана выбранная запись; полный каталог ещё не готов. Запустите sync без ID.')
  const catalog = { collectionId, sourceUrl: starlightSource, title: manifest.title, state: 'ready', tracks: manifest.tracks }
  catalog.revision = digest(JSON.stringify(sort(catalog)))
  const changed = await writeVerified(db.doc(`materialAudioCollections/${collectionId}`), catalog)
  save(resolve(folder, 'published.json'), catalog)
  console.log(JSON.stringify({ collectionId, ready: true, tracks: uploaded, objectsWritten, catalogChanged: changed, readback: true }))
} else if (command === 'link') {
  if (!argument) throw new Error('Использование: npm run audio -- link .local/audio-binding.json [--apply]')
  const input = read(resolve(argument))
  // Validate address syntax before constructing any Firestore paths.
  const addressErrors = bindingErrors(input, {}, { status: 'confirmed', subjectKey: 'английский язык' }, { tracks: [{}], state: 'ready' })
  if (addressErrors.length) throw new Error(addressErrors.join(' '))
  const db = firestore()
  const childRef = db.doc(`families/${input.familyId}/children/${input.childId}`)
  const bookRef = childRef.collection('books').doc(input.bookId)
  const [child, book, shared] = await Promise.all([childRef.get(), bookRef.get(), db.doc(`materialAudioCollections/${input.collectionId}`).get()])
  const errors = bindingErrors(input, child.data(), book.data(), shared.data())
  if (errors.length) throw new Error(errors.join(' '))
  const catalog = shared.data()
  const audioLibrary = { collectionId: input.collectionId, revision: catalog.revision, sourceUrl: catalog.sourceUrl,
    evidence: input.evidence, tracks: catalog.tracks.map(audioLink) }
  const unchanged = JSON.stringify(sort(book.data().audioLibrary)) === JSON.stringify(sort(audioLibrary))
  if (process.argv.includes('--apply') && !unchanged) {
    // Field-only update preserves concurrently refreshed page markers and book evidence.
    await bookRef.update({ audioLibrary })
    const after = (await bookRef.get()).data()?.audioLibrary
    if (JSON.stringify(sort(after)) !== JSON.stringify(sort(audioLibrary))) throw new Error('Семейная связь не подтверждена обратным чтением.')
  }
  console.log(JSON.stringify({ collectionId, tracks: audioLibrary.tracks.length, unchanged,
    applied: process.argv.includes('--apply'), readback: process.argv.includes('--apply') }))
} else throw new Error('Команды: discover; sync [TRACK_ID] [--refresh]; link BINDING.json [--apply].')
