import { useEffect, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { AlertCircle, BookOpen, CheckCircle2, ChevronDown, RefreshCw, Upload } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { DocumentData, QuerySnapshot } from 'firebase/firestore'
import { requestFamilyBookUpload, setFamilyBookRequirement } from '@/lib/familyBookUpload'
import { useFamilyLibrary } from '@/lib/familyLibrary'
import { completeMaterialPages, readMaterialPages, writeMaterialPages } from '@/lib/materialPageCache'
import { readBookPageSource } from '@/lib/bookPageSource'
import type { BookNeed } from '@/lib/familyLibrary'
import type { PersonalChild } from '@/lib/personalAccess'
import type { DayMaterialLink } from '@/lib/dayStore'
import MaterialReader from './MaterialReader'
import './FamilyLibrary.css'
import { useDelayedRefresh } from '@/lib/useDelayedRefresh'
import { reportUiError } from '@/lib/uiErrors'

// @see ../../docs/architecture/local-first-revision-matrix.md#матрица-чтения
// Published page sets are immutable for one binding revision. Reopening a book
// in the same tab must not reread every page or create another live listener.
const publishedPageCache = new Map<string, DayMaterialLink[]>()

function FamilyBookPages({ familyId, childId, bookId, expectedCount, revision, sourceSha256, manifestReady }: { familyId: string; childId: string; bookId: string; expectedCount?: number; revision?: string; sourceSha256?: string; manifestReady: boolean }) {
  const [links, setLinks] = useState<DayMaterialLink[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    // A publication marker without the expected page count cannot prove that
    // the cached set is complete. Keep its server-backed path until repaired.
    const cacheKey = revision && sourceSha256 && expectedCount && expectedCount > 0
      ? `${familyId}/${childId}/${bookId}/${revision}` : null
    const cached = cacheKey ? publishedPageCache.get(cacheKey) : undefined
    if (cached && expectedCount && sourceSha256 && completeMaterialPages(cached, expectedCount, sourceSha256)) {
      setLinks(cached); setError(''); return () => { active = false }
    }
    setLinks(null)
    const pages = query(collection(db, 'families', familyId, 'children', childId, 'bookPages'), where('bookId', '==', bookId))
    const receive = (snapshot: QuerySnapshot<DocumentData>) => {
      if (!active) return
      const next = snapshot.docs.filter((item) => item.data().state === 'published'
        && typeof item.data().url === 'string').map((item) => ({
        title: item.data().title || `${item.data().subject || 'Учебник'}, стр. ${item.data().printedPage}`,
        url: item.data().url, sourceType: 'textbook-page', sourceRef: item.data().sourceRef,
        pdfPage: item.data().pdfPage, printedPage: item.data().printedPage,
        editionStatus: item.data().editionStatus, extraction: item.data().extraction,
        sourceSha256: item.data().sourceSha256,
      } as DayMaterialLink)).sort((a, b) => (a.pdfPage ?? 0) - (b.pdfPage ?? 0))
      // A stale or partly published set is never cached as a complete revision.
      if (cacheKey && sourceSha256 && expectedCount && next.some((link) => link.sourceSha256 !== sourceSha256)) {
        setLinks(null)
        setError('Страницы не совпадают с подтверждённым изданием. Нужна повторная публикация книги.')
        return
      }
      if (cacheKey && sourceSha256 && expectedCount && completeMaterialPages(next, expectedCount, sourceSha256)) {
        publishedPageCache.set(cacheKey, next)
        void writeMaterialPages(cacheKey, next).catch(() => {})
      }
      setLinks(next)
      setError('')
    }
    const fail = (cause: Error) => { if (active) setError(reportUiError(cause, 'Страницы учебника')) }
    if (cacheKey) {
      void readMaterialPages(cacheKey, expectedCount!, sourceSha256!).catch(() => null).then((stored) => {
        if (!active) return
        if (stored) { publishedPageCache.set(cacheKey, stored); setLinks(stored); setError('') }
        else void readBookPageSource({ manifestReady, expectedCount: expectedCount!, sourceSha256: sourceSha256! }, {
          readManifest: async () => (await getDoc(doc(db, 'families', familyId, 'children', childId, 'bookPages', `${bookId}#manifest`))).data(),
          readLegacy: () => getDocs(pages),
        }).then((result) => {
          if (!active) return
          if (result.kind === 'legacy') receive(result.value)
          else {
            publishedPageCache.set(cacheKey, result.links)
            void writeMaterialPages(cacheKey, result.links).catch(() => {})
            setLinks(result.links); setError('')
          }
        }, fail)
      })
      return () => { active = false }
    }
    const stop = onSnapshot(pages, receive, fail)
    return () => { active = false; stop() }
  }, [familyId, childId, bookId, expectedCount, revision, sourceSha256, manifestReady])
  if (error) return <p role="alert">Не удалось открыть страницы: {error}</p>
  if (!links) return <p>Загружаем страницы…</p>
  if (!links.length) return <p>PDF привязан к семье; изображения страниц ещё не опубликованы. Повторно загружать книгу не нужно.</p>
  return <>{expectedCount && links.length < expectedCount && <p>Доступно {links.length} из {expectedCount} страниц. Повторно загружать книгу не нужно.</p>}<MaterialReader links={links} parent book /></>
}

function FamilyBookEntry({ familyId, childId, childName, bookId, title, multipleChildren, expectedCount, ready, revision, sourceSha256, manifestReady }: { familyId: string; childId: string; childName: string; bookId: string; title: string; multipleChildren: boolean; expectedCount?: number; ready: boolean; revision?: string; sourceSha256?: string; manifestReady: boolean }) {
  const [open, setOpen] = useState(false)
  return <li className="family-library-book-entry"><div>{ready ? <CheckCircle2 size={17} aria-hidden="true" /> : <AlertCircle className="family-library-unpublished" size={17} aria-hidden="true" />}<span><strong>{title}</strong>{multipleChildren ? ` · ${childName}` : ''}{ready && expectedCount ? ` · ${expectedCount} стр.` : ' · публикация страниц не завершена'}</span><button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? 'Скрыть страницы' : 'Открыть книгу'}</button></div>
    {open && <FamilyBookPages familyId={familyId} childId={childId} bookId={bookId} expectedCount={expectedCount} revision={ready ? revision : undefined} sourceSha256={ready ? sourceSha256 : undefined} manifestReady={ready && manifestReady} />}
  </li>
}

function uploadLabel(need: BookNeed) {
  const upload = need.uploads.at(-1)
  if (!upload) return ''
  if (upload.status === 'requested') return 'Ожидает приёмника загрузок'
  if (upload.status === 'awaiting-upload') return 'Передаём файл на Диск'
  if (upload.status === 'uploaded') return 'Проверяем исходный файл'
  if (upload.status === 'upload-error') return upload.error ? `Файл не принят: ${upload.error}` : 'Файл не принят; попробуйте загрузить ещё раз'
  if (upload.status === 'needs-identification' || upload.status === 'stored') return 'PDF принят; издание ещё не определено. После сверки страницы попадут в индекс'
  return 'Связываем с библиотекой семьи'
}

function pagesReady(book: { pagesPublishedAt?: unknown; pagesPublishedSha256?: string; catalogSha256?: string; sourceSha256?: string }) {
  return Boolean(book.pagesPublishedAt && book.pagesPublishedSha256
    && book.pagesPublishedSha256 === (book.catalogSha256 ?? book.sourceSha256))
}

function pagesRevision(book: { pagesPublishedAt?: unknown; pagesPublishedSha256?: string }) {
  const timestamp = book.pagesPublishedAt as { toMillis?: () => number; seconds?: number; nanoseconds?: number } | undefined
  const millis = timestamp?.toMillis?.() ?? (typeof timestamp?.seconds === 'number' ? timestamp.seconds * 1000 + Math.floor((timestamp.nanoseconds ?? 0) / 1_000_000) : undefined)
  return book.pagesPublishedSha256 && Number.isFinite(millis) ? `${book.pagesPublishedSha256}:${millis}` : undefined
}

/** @see ../../docs/product/design-system.md#cards-and-status
 *  @see ../../docs/product/family-library.md#parent-dashboard */
export function FamilyLibrary({ familyId, familyChildren }: { familyId: string; familyChildren: PersonalChild[] }) {
  const library = useFamilyLibrary(familyId, familyChildren)
  const showRefresh = useDelayedRefresh(Boolean(library.fromCache && !library.error))
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const needs = library.needs.filter((need) => need.state === 'missing' || need.state === 'pending' || need.state === 'review')
  const confirmed = library.books.filter((book) => book.status === 'confirmed')
  const provisional = library.books.filter((book) => book.status === 'provisional')
  const viewableCount = library.books.filter(pagesReady).length
  const missing = needs.filter((need) => need.state === 'missing')
  const hasCompleteSnapshot = !library.loading && (!library.error || library.fromCache)
  const unresolved = hasCompleteSnapshot && (library.observedDays === 0 || library.observedSubjects === 0 || library.unobservedChildren.length > 0 || needs.length > 0)

  async function upload(need: BookNeed, file: File) {
    const id = `${need.childId}:${need.subjectKey}`
    setBusy(id); setActionError('')
    try { await requestFamilyBookUpload(familyId, need.childId, need.subjectKey, file) }
    catch (cause) { setActionError(reportUiError(cause, 'Загрузка учебника')) }
    finally { setBusy(''); if (fileInputs.current[id]) fileInputs.current[id]!.value = '' }
  }
  async function setPolicy(need: BookNeed, policy: 'required' | 'no-book') {
    const id = `${need.childId}:${need.subjectKey}`
    setBusy(id); setActionError('')
    try { await setFamilyBookRequirement(familyId, need.childId, need.subjectKey, policy) }
    catch (cause) { setActionError(reportUiError(cause, 'Правило для учебника')) }
    finally { setBusy('') }
  }

  return <section className={`family-library ${unresolved ? 'family-library-needs' : 'family-library-ready'}`} aria-label="Учебники семьи">
    {unresolved ? <div className="family-library-main">
      <div className="family-library-heading"><AlertCircle size={23} aria-hidden="true" /><div><h2>Нужны учебники и материалы</h2><p>Для проверки заданий нужны книги именно вашей семьи. Предметы взяты из загруженного расписания; общий архив не назначает семье учебник автоматически.</p></div></div>
      {library.observedDays === 0 || library.observedSubjects === 0 ? <p>Предметы расписания ещё не загружены. После их появления здесь будет список нужных учебников.</p>
            : <><p className="family-library-count">{missing.length ? `Не хватает по ${missing.length} ${missing.length === 1 ? 'предмету' : 'предметам'}.` : 'Переданные файлы обрабатываются или состав материалов уточняется.'}</p>
              {library.unobservedChildren.length > 0 && <p>Расписание пока не содержит предметы для: {library.unobservedChildren.join(', ')}. Комплект этого ребёнка ещё неизвестен.</p>}
              {needs.map((need) => { const id = `${need.childId}:${need.subjectKey}`; return <div className="family-library-row" key={id}>
                <div><strong>{need.subject}</strong><span>{familyChildren.length > 1 ? `${need.childName} · ` : ''}{need.state === 'pending' || need.uploads.at(-1)?.status === 'upload-error' ? uploadLabel(need) : need.state === 'review' ? 'Уточните, используется ли учебник или материалы курса' : need.books.some((book) => book.status === 'provisional') ? 'Передан PDF другого издания; точный учебник пока не подтверждён' : 'Учебник не подтверждён для этого ребёнка'}</span></div>
                <div className="family-library-actions"><input ref={(element) => { fileInputs.current[id] = element }} type="file" accept=".pdf,application/pdf" aria-label={`Загрузить материал: ${need.subject}, ${need.childName}`} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(need, file) }} hidden />
                  <button type="button" disabled={busy === id} onClick={() => fileInputs.current[id]?.click()}><Upload size={16} aria-hidden="true" /> {busy === id ? 'Сохраняем…' : need.state === 'pending' ? 'Другой PDF' : 'Загрузить PDF'}</button>
                  {need.state === 'review' && <button type="button" className="family-library-secondary" disabled={busy === id} onClick={() => void setPolicy(need, 'no-book')}>Учебника нет</button>}
                </div>
              </div> })}
              {actionError && <p className="family-library-error" role="alert">{actionError}</p>}
              <small>Пока принимаем полный PDF учебника. Файл сверяется с общим архивом; новая книга попадёт в библиотеку после определения издания и индексации. Загрузка отдельных фотографий страниц запланирована отдельно.</small>
            </>}
    </div> : null}
    <details className="family-library-list" open={hasCompleteSnapshot && !unresolved && confirmed.length + provisional.length === 0}>
      <summary><BookOpen size={19} aria-hidden="true" /><span>{hasCompleteSnapshot ? `Библиотека семьи · ${confirmed.length + provisional.length} ${confirmed.length + provisional.length === 1 ? 'книга' : 'книг'} · просмотр ${viewableCount}/${confirmed.length + provisional.length}` : 'Библиотека семьи'}</span>{showRefresh && <RefreshCw className="family-library-refresh" size={14} aria-label="Обновление библиотеки" />}{library.error && <span className="family-library-sync-error" title="Обновление библиотеки пока недоступно">!</span>}<ChevronDown size={18} aria-hidden="true" /></summary>
      {confirmed.length ? <ul>{confirmed.map((book) => <FamilyBookEntry key={`${book.childId}:${book.bookId}`} familyId={familyId} childId={book.childId} childName={familyChildren.find((child) => child.childId === book.childId)?.displayName ?? 'Ребёнок'} bookId={book.bookId} title={book.title} multipleChildren={familyChildren.length > 1} expectedCount={book.pdfPageCount} ready={pagesReady(book)} revision={pagesRevision(book)} sourceSha256={book.pagesPublishedSha256} manifestReady={book.pagesManifestSha256 === book.pagesPublishedSha256} />)}</ul>
        : <p>Подтверждённых книг пока нет. Общие документы других семей здесь не отображаются.</p>}
      {provisional.length > 0 && <div className="family-library-provisional"><strong>Переданы, но издание ещё не подтверждено для уроков</strong><ul>{provisional.map((book) => <FamilyBookEntry key={`${book.childId}:${book.bookId}`} familyId={familyId} childId={book.childId} childName={familyChildren.find((child) => child.childId === book.childId)?.displayName ?? 'Ребёнок'} bookId={book.bookId} title={book.title} multipleChildren={familyChildren.length > 1} expectedCount={book.pdfPageCount} ready={pagesReady(book)} revision={pagesRevision(book)} sourceSha256={book.pagesPublishedSha256} manifestReady={book.pagesManifestSha256 === book.pagesPublishedSha256} />)}</ul></div>}
      {hasCompleteSnapshot && !unresolved && !library.fromCache && <p className="family-library-note">Комплект для известных предметов подтверждён. Если расписание изменится, нужные книги снова появятся наверху кабинета.</p>}
    </details>
  </section>
}
