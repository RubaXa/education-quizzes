import { createHash } from 'node:crypto'

/** Shared audio has no learner fields. Binding and assignment edges stay private.
 * @see ../docs/modules/materials/audio-library.md */
export const starlightSource = 'https://tankmet.ru/english/starlight6.html'
export const collectionId = 'starlight-6'
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
// Both page-relative links return 404; the sibling directory originals were
// independently checked (HTTP 200) on 2026-10-22. Preserve the advertised href.
const correctedHrefs = new Set(['5-22 - Ex. 4b p. 95.mp3', '5-23 - Еx. 1 p. 96.mp3'])

export function audioSourceUrl(value) {
  const url = new URL(value, starlightSource)
  if (url.origin !== 'https://tankmet.ru' || !url.pathname.startsWith('/english/starlight-6/')
    || !url.pathname.endsWith('.mp3') || url.search || url.hash || url.username || url.password) throw new Error('Недопустимый источник аудио.')
  return url.href
}

export function discoverAudio(html) {
  const tracks = new Map()
  for (const [, href] of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    if (!/\.mp3$/i.test(href)) continue
    const sourceHref = href.replace(/&amp;/g, '&')
    const corrected = correctedHrefs.has(sourceHref)
    const sourceUrl = audioSourceUrl(corrected ? `/english/starlight-6/${sourceHref}` : sourceHref)
    const name = decodeURIComponent(new URL(sourceUrl).pathname.split('/').at(-1)).replace(/\.mp3$/i, '')
    const match = /^(\d+-\d+|wb-\d+)\s*-\s*(Ex\.|Part)\s*([\da-z,]+)\s+(?:p\.\s*)?(\d+)\.?$/i.exec(name.replace('Еx.', 'Ex.'))
    const test = /^test-(\d+)$/i.exec(name)
    if (!match && !test) throw new Error(`Не распознана запись ${name}.`)
    const kind = test ? 'test' : name.startsWith('wb-') ? 'wb' : 'sb'
    const track = match?.[1] ?? `test-${test[1]}`
    const exercise = match?.[3].toLowerCase() ?? null
    const page = match ? Number(match[4]) : null
    const id = `${collectionId}-${track}`
    const title = `Starlight 6 · ${kind === 'sb' ? 'Учебник' : kind === 'wb' ? 'Рабочая тетрадь' : 'Контрольные записи'} · ${match ? `с. ${page}, ${match[2].toLowerCase() === 'part' ? 'часть' : 'упр.'} ${exercise}` : `тест ${test[1]}`}`
    if (tracks.has(id) && tracks.get(id).sourceUrl !== sourceUrl) throw new Error('Повтор номера с другим источником.')
    tracks.set(id, { id, collectionId, kind, track, page, exercise, sourceHref,
      ...(corrected ? { sourceCorrection: '2026-10-22: advertised relative URL HTTP 404; sibling directory original HTTP 200' } : {}),
      sourceLabel: name, exerciseType: match?.[2].toLowerCase() === 'part' ? 'part' : 'exercise', title, sourceUrl })
  }
  if (!tracks.size) throw new Error('На странице не найдены аудиозаписи.')
  return [...tracks.values()]
}

export function verifyAudio(bytes) {
  // ID3 or an MPEG frame header; reject HTML/JSON success pages and oversized responses.
  if (!bytes.length || bytes.length > 30 * 1024 * 1024
    || !(bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) {
    throw new Error('Источник не вернул допустимый MP3 (до 30 МБ).')
  }
  return { sha256: digest(bytes), md5: createHash('md5').update(bytes).digest('hex'), size: bytes.length }
}

export function audioLink(track) {
  if (!/^[a-f0-9]{64}$/.test(track.sha256 ?? '') || !/^https:\/\/(disk\.yandex\.ru|yadi\.sk)\//.test(track.url ?? '')) throw new Error('Запись ещё не подтверждена на Яндекс.Диске.')
  return { title: track.title, url: track.url, sourceType: 'audio', sourceRef: `audio:${track.id}`,
    sourceSha256: track.sha256, collectionId: track.collectionId, audioKind: track.kind,
    printedPage: track.page, exercise: track.exercise, exerciseType: track.exerciseType, sourceUrl: track.sourceUrl }
}

/** The exact MESH instruction, never generated guidance, chooses exercises. */
export function assignmentAudio(task, library, pageLinks = []) {
  if (!library?.tracks?.length || !task.meshText || task.instructionStatus?.state === 'needs-review'
    || task.materialStatus?.state === 'textbook-page-needed') return []
  const text = task.meshText.toLowerCase()
  // Mixed SB/WB instructions and multiple page references need an explicit edge.
  const kinds = [...text.matchAll(/\b(sb|wb)\b|рабоч(?:ая|ей)\s+тетрад[ьи]|учебник[ае]?/g)].map((m) => m[1] === 'wb' || m[0].startsWith('рабоч') ? 'wb' : 'sb')
  if (new Set(kinds).size > 1) return []
  const kind = kinds[0] ?? (pageLinks.some((link) => link.sourceType === 'textbook-page' && link.sourceRef?.startsWith(`${library.bookId}#`)) ? 'sb' : null)
  if (!kind) return []
  const pages = [...text.matchAll(/(?:стр\.?|с\.|p\.?|page)\s*(\d+)(?!\d)/g)].map((m) => Number(m[1]))
  if (new Set(pages).size !== 1 || /(?:стр\.?|с\.|p\.?|page)\s*\d+\s*[-–,]/.test(text)) return []
  const exercises = [...text.matchAll(/(?:упр\.?|ex\.?|exercise)\s*(\d+[a-z]?)/g)].map((m) => m[1])
  if (!exercises.length) return []
  // Lists/ranges like "упр. 2, 3" are deliberately left for explicit linking.
  if (/(?:упр\.?|ex\.?|exercise)\s*\d+[a-z]?\s*[,–-]\s*\d/.test(text)) return []
  return library.tracks.filter((track) => track.audioKind === kind && track.printedPage === pages[0]
    && track.exerciseType === 'exercise' && exercises.some((exercise) => track.exercise === exercise
      || /^\d+$/.test(exercise) && new RegExp(`^${exercise}[a-z]$`).test(track.exercise ?? '')))
}

export function boundAssignmentAudio(source, books, pageLinks) {
  const result = {}
  for (const subject of source.subjects ?? []) {
    if (subject.name.toLowerCase() !== 'английский язык') continue
    for (const task of subject.tasks ?? []) {
      const links = books.filter((book) => book.status === 'confirmed' && book.audioLibrary)
        .flatMap((book) => assignmentAudio(task, { ...book.audioLibrary, bookId: book.bookId }, pageLinks?.[task.id] ?? []))
      if (links.length) result[task.id] = [...new Map(links.map((link) => [link.sourceRef, link])).values()]
    }
  }
  return result
}

export function bindingErrors(input, child, book, catalog) {
  const errors = []
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(input.familyId ?? '') || !/^[A-Za-z0-9_-]{20,80}$/.test(input.childId ?? '')
    || !/^[a-z0-9-]+$/.test(input.bookId ?? '') || input.collectionId !== collectionId) errors.push('Неверные адресные идентификаторы.')
  if (!child || !book || book.status !== 'confirmed' || book.subjectKey !== 'английский язык') errors.push('Нет подтверждённой семейной книги английского языка.')
  if (!catalog?.tracks?.length || catalog.state !== 'ready') errors.push('Общий каталог ещё не синхронизирован.')
  if (input.evidence?.kind !== 'parent-selected-public-audio' || input.evidence.sourceUrl !== starlightSource
    || typeof input.evidence.note !== 'string' || input.evidence.note.trim().length < 30) errors.push('Нужно явное основание выбора публичного аудио родителем.')
  return errors
}
