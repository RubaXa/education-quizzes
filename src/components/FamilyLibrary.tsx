import { useEffect, useRef, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { AlertCircle, BookOpen, CheckCircle2, ChevronDown, Upload } from 'lucide-react'
import { db } from '@/lib/firebase'
import { requestFamilyBookUpload, setFamilyBookRequirement } from '@/lib/familyBookUpload'
import { useFamilyLibrary } from '@/lib/familyLibrary'
import type { BookNeed } from '@/lib/familyLibrary'
import type { PersonalChild } from '@/lib/personalAccess'
import type { DayMaterialLink } from '@/lib/dayStore'
import MaterialReader from './MaterialReader'
import './FamilyLibrary.css'
import { reportUiError } from '@/lib/uiErrors'

function FamilyBookPages({ familyId, childId, bookId }: { familyId: string; childId: string; bookId: string }) {
  const [links, setLinks] = useState<DayMaterialLink[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => onSnapshot(collection(db, 'families', familyId, 'children', childId, 'bookPages'), (snapshot) => {
    setLinks(snapshot.docs.filter((item) => item.data().bookId === bookId && item.data().state === 'published'
      && typeof item.data().url === 'string').map((item) => ({
      title: item.data().title || `${item.data().subject || 'Учебник'}, стр. ${item.data().printedPage}`,
      url: item.data().url, sourceType: 'textbook-page', sourceRef: item.data().sourceRef,
      pdfPage: item.data().pdfPage, printedPage: item.data().printedPage,
      editionStatus: item.data().editionStatus, extraction: item.data().extraction,
      sourceSha256: item.data().sourceSha256,
    } as DayMaterialLink)).sort((a, b) => (a.pdfPage ?? 0) - (b.pdfPage ?? 0)))
    setError('')
  }, (cause) => setError(reportUiError(cause, 'Страницы учебника'))), [familyId, childId, bookId])
  if (error) return <p role="alert">Не удалось открыть страницы: {error}</p>
  if (!links) return <p>Загружаем страницы…</p>
  return links.length ? <MaterialReader links={links} parent /> : <p>Страницы этой книги ещё не опубликованы для просмотра. Сам PDF сохранён приватно.</p>
}

function FamilyBookEntry({ familyId, childId, childName, bookId, title, multipleChildren }: { familyId: string; childId: string; childName: string; bookId: string; title: string; multipleChildren: boolean }) {
  const [open, setOpen] = useState(false)
  return <li className="family-library-book-entry"><div><CheckCircle2 size={17} aria-hidden="true" /><span><strong>{title}</strong>{multipleChildren ? ` · ${childName}` : ''}</span><button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? 'Скрыть страницы' : 'Открыть страницы'}</button></div>
    {open && <FamilyBookPages familyId={familyId} childId={childId} bookId={bookId} />}
  </li>
}

function uploadLabel(need: BookNeed) {
  const upload = need.uploads.at(-1)
  if (!upload) return ''
  if (upload.status === 'requested') return 'Ожидает приёмника загрузок'
  if (upload.status === 'awaiting-upload') return 'Передаём файл на Диск'
  if (upload.status === 'uploaded') return 'Проверяем исходный файл'
  if (upload.status === 'upload-error') return upload.error ? `Файл не принят: ${upload.error}` : 'Файл не принят; попробуйте загрузить ещё раз'
  if (upload.status === 'needs-identification' || upload.status === 'stored') return 'Файл принят; определяем издание и индексируем страницы'
  return 'Связываем с библиотекой семьи'
}

/** @see ../../docs/product/design-system.md#cards-and-status
 *  @see ../../docs/product/family-library.md#parent-dashboard */
export function FamilyLibrary({ familyId, familyChildren }: { familyId: string; familyChildren: PersonalChild[] }) {
  const library = useFamilyLibrary(familyId, familyChildren)
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const needs = library.needs.filter((need) => need.state === 'missing' || need.state === 'pending' || need.state === 'review')
  const confirmed = library.books.filter((book) => book.status === 'confirmed')
  const provisional = library.books.filter((book) => book.status === 'provisional')
  const missing = needs.filter((need) => need.state === 'missing')
  const unresolved = library.loading || Boolean(library.error) || library.observedDays === 0 || library.observedSubjects === 0 || library.unobservedChildren.length > 0 || needs.length > 0

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
      {library.error ? <p role="alert">Не удалось проверить комплект книг: {library.error}. Сведения о наличии книг пока неизвестны.</p>
        : library.loading ? <p>Сверяем расписание и библиотеку семьи…</p>
          : library.observedDays === 0 || library.observedSubjects === 0 ? <p>Предметы расписания ещё не загружены. После их появления здесь будет список нужных учебников.</p>
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
    <details className="family-library-list" open={!unresolved && confirmed.length + provisional.length === 0}>
      <summary><BookOpen size={19} aria-hidden="true" /><span>Библиотека семьи · {confirmed.length + provisional.length} {confirmed.length + provisional.length === 1 ? 'книга' : 'книг'}</span><ChevronDown size={18} aria-hidden="true" /></summary>
      {confirmed.length ? <ul>{confirmed.map((book) => <FamilyBookEntry key={`${book.childId}:${book.bookId}`} familyId={familyId} childId={book.childId} childName={familyChildren.find((child) => child.childId === book.childId)?.displayName ?? 'Ребёнок'} bookId={book.bookId} title={book.title} multipleChildren={familyChildren.length > 1} />)}</ul>
        : <p>Подтверждённых книг пока нет. Общие документы других семей здесь не отображаются.</p>}
      {provisional.length > 0 && <div className="family-library-provisional"><strong>Переданы, но издание ещё не подтверждено для уроков</strong><ul>{provisional.map((book) => <li key={`${book.childId}:${book.bookId}`}>{book.title}{familyChildren.length > 1 ? ` · ${familyChildren.find((child) => child.childId === book.childId)?.displayName ?? 'Ребёнок'}` : ''}</li>)}</ul></div>}
      {!unresolved && <p className="family-library-note">Комплект для известных предметов подтверждён. Если расписание изменится, нужные книги снова появятся наверху кабинета.</p>}
    </details>
  </section>
}
