import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from './firebase'
import { watchDayDashboard } from './dayDashboardStore'
import type { PersonalChild } from './personalAccess'
import { resumeFamilyBookTransfer } from './familyBookUpload'
import { reportUiError } from './uiErrors'

/** @see ../../docs/product/family-library.md#coverage */
export type FamilyBook = {
  id: string
  childId: string
  subjectKey: string
  bookId: string
  title: string
  status: 'confirmed' | 'provisional'
  sourceSha256?: string
  catalogSha256?: string
  pdfPageCount?: number
  pagesPublishedSha256?: string
  pagesManifestSha256?: string
  pagesPublishedAt?: unknown
}
export type FamilyBookUpload = {
  id: string
  childId: string
  subjectKey: string
  originalName: string
  status: 'requested' | 'awaiting-upload' | 'uploaded' | 'stored' | 'needs-identification' | 'linked' | 'upload-error'
  error?: string
  upload?: { href: string }
}
export type BookNeed = { childId: string; childName: string; subject: string; subjectKey: string; state: 'missing' | 'pending' | 'confirmed' | 'review' | 'no-book'; books: FamilyBook[]; uploads: FamilyBookUpload[] }
export type BookRequirement = { childId: string; subjectKey: string; policy: 'required' | 'no-book' }

const aliases: Record<string, string> = {
  'русский': 'русский язык', 'русский язык': 'русский язык',
  'английский': 'английский язык', 'английский язык': 'английский язык',
  'математика': 'математика', 'алгебра': 'алгебра', 'геометрия': 'геометрия',
  'литература': 'литература', 'история': 'история', 'география': 'география',
  'биология': 'биология', 'физика': 'физика', 'химия': 'химия',
  'обществознание': 'обществознание', 'информатика': 'информатика',
  'французский язык': 'французский язык', 'немецкий язык': 'немецкий язык',
}
const noBook = /^(физическая культура|физкультура|изобразительное искусство|изо|музыка|труд|технология|ров|разговоры о важном)$/i

export function subjectKey(subject: string) {
  const normalized = subject.toLocaleLowerCase('ru').replace(/\s+/g, ' ').trim()
  return aliases[normalized] ?? normalized
}
export function defaultBookPolicy(subject: string): 'required' | 'no-book' | 'review' {
  const key = subjectKey(subject)
  if (noBook.test(key)) return 'no-book'
  if (aliases[key]) return 'required'
  return 'review'
}

/** Only a confirmed binding for this child covers a subject; global catalog presence never does. */
export function bookNeeds(children: PersonalChild[], schedules: Record<string, string[]>, books: FamilyBook[], uploads: FamilyBookUpload[], requirements: BookRequirement[] = []): BookNeed[] {
  const result: BookNeed[] = []
  for (const child of children) {
    const subjects = new Map<string, string>()
    for (const subject of schedules[child.childId] ?? []) subjects.set(subjectKey(subject), subject)
    for (const [subjectKeyValue, subject] of subjects) {
      const relevantBooks = books.filter((book) => book.childId === child.childId && book.subjectKey === subjectKeyValue)
      const relevantUploads = uploads.filter((upload) => upload.childId === child.childId && upload.subjectKey === subjectKeyValue)
      const activeUploads = relevantUploads.filter((upload) => upload.status !== 'upload-error')
      const policy = requirements.find((entry) => entry.childId === child.childId && entry.subjectKey === subjectKeyValue)?.policy ?? defaultBookPolicy(subject)
      const state = relevantBooks.some((book) => book.status === 'confirmed') ? 'confirmed'
        : activeUploads.length ? 'pending' : policy === 'required' ? 'missing' : policy === 'no-book' ? 'no-book' : 'review'
      result.push({ childId: child.childId, childName: child.displayName, subject, subjectKey: subjectKeyValue, state, books: relevantBooks, uploads: relevantUploads })
    }
  }
  return result.sort((a, b) => a.childName.localeCompare(b.childName, 'ru') || a.subject.localeCompare(b.subject, 'ru'))
}

type LibraryState = { loading: boolean; error: string; observedDays: number; observedSubjects: number; unobservedChildren: string[]; needs: BookNeed[]; books: FamilyBook[]; fromCache?: boolean }

export function familyLibraryCacheKey(familyId: string, children: PersonalChild[]) {
  return `education-family-library-v1:${familyId}:${children.map((child) => child.childId).sort().join(',')}`
}

function readLibrary(familyId: string, children: PersonalChild[]): LibraryState | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(familyLibraryCacheKey(familyId, children)) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const state = value as LibraryState
    return state.loading === false && Array.isArray(state.books) && Array.isArray(state.needs) &&
      Number.isSafeInteger(state.observedDays) && Number.isSafeInteger(state.observedSubjects) &&
      Array.isArray(state.unobservedChildren) && state.books.every((book) => book && typeof book.id === 'string' &&
        typeof book.title === 'string' && typeof book.childId === 'string' && (book.status === 'confirmed' || book.status === 'provisional')) &&
      state.needs.every((need) => need && typeof need.childId === 'string' && typeof need.subject === 'string' &&
        Array.isArray(need.books) && Array.isArray(need.uploads)) ? { ...state, fromCache: true } : null
  } catch { return null }
}

function rememberLibrary(familyId: string, children: PersonalChild[], state: LibraryState) {
  const safe = { ...state, fromCache: false, needs: state.needs.map((need) => ({ ...need,
    uploads: need.uploads.map(({ upload: _upload, ...item }) => item) })) }
  try { localStorage.setItem(familyLibraryCacheKey(familyId, children), JSON.stringify(safe)) }
  catch { /* The live library still works without local persistence. */ }
}

export function useFamilyLibrary(familyId: string, children: PersonalChild[]): LibraryState {
  const [state, setState] = useState<LibraryState>(() => readLibrary(familyId, children) ?? { loading: true, error: '', observedDays: 0, observedSubjects: 0, unobservedChildren: [], needs: [], books: [] })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    let retryTimer: number | undefined
    const cached = readLibrary(familyId, children)
    const schedules: Record<string, string[]> = {}
    const bindings: Record<string, FamilyBook[]> = {}
    const requirements: Record<string, BookRequirement[]> = {}
    const uploads: Record<string, FamilyBookUpload[]> = {}
    const ready = new Set<string>()
    let error = ''
    const dayCounts: Record<string, number> = {}
    const required = children.length * 4
    const emit = () => {
      if (!active) return
      // A failed or incomplete refresh is not evidence that the family has no books.
      // Keep the last complete snapshot until every source has answered again.
      if (ready.size < required) {
        if (cached) setState({ ...cached, error })
        else setState({ loading: !error, error, observedDays: 0, observedSubjects: 0,
          unobservedChildren: [], needs: [], books: [] })
        return
      }
      const next: LibraryState = { loading: !error && ready.size < required, error,
        observedDays: Object.values(dayCounts).reduce((sum, count) => sum + count, 0),
        observedSubjects: Object.values(schedules).flat().map(subjectKey).filter((value, index, all) => all.indexOf(value) === index).length,
        unobservedChildren: children.filter((child) => !schedules[child.childId]?.length).map((child) => child.displayName),
        books: Object.values(bindings).flat(),
        needs: bookNeeds(children, schedules, Object.values(bindings).flat(), Object.values(uploads).flat(), Object.values(requirements).flat()) }
      setState(next)
      if (!next.loading && !next.error) rememberLibrary(familyId, children, next)
    }
    const fail = (cause: Error) => {
      error = reportUiError(cause, 'Семейная библиотека'); emit()
      if (retryTimer === undefined) retryTimer = window.setTimeout(() => {
        if (active) setRetry((value) => value + 1)
      }, Math.min(120_000, 5_000 * 2 ** Math.min(retry, 5)))
    }
    const retryOnReconnect = () => { if (active && error) setRetry((value) => value + 1) }
    window.addEventListener('online', retryOnReconnect)
    const stops: (() => void)[] = []
    // Cached parent screens render before Firebase Auth restores its session.
    // Starting protected listeners earlier can permanently fail on a warm launch.
    void getAuth().authStateReady().then(() => {
      if (!active) return
      if (!getAuth().currentUser) { fail(new Error('Сессия ещё не восстановлена')); return }
      for (const child of children) {
      if (child.dashboardToken) stops.push(watchDayDashboard(child.dashboardToken, (index) => {
        schedules[child.childId] = index.days.flatMap((day) => day.schedule.map((lesson) => lesson.subject))
        dayCounts[child.childId] = index.days.length
        ready.add(`schedule:${child.childId}`); emit()
      }, fail))
      else { schedules[child.childId] = []; ready.add(`schedule:${child.childId}`) }
      stops.push(onSnapshot(collection(db, 'families', familyId, 'children', child.childId, 'books'), { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.metadata?.fromCache) return
        bindings[child.childId] = snapshot.docs.map((item) => ({ id: item.id, childId: child.childId, ...item.data() } as FamilyBook))
        ready.add(`books:${child.childId}`); emit()
      }, fail))
      stops.push(onSnapshot(collection(db, 'families', familyId, 'children', child.childId, 'bookUploads'), { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.metadata?.fromCache) return
        uploads[child.childId] = snapshot.docs.map((item) => ({ id: item.id, childId: child.childId, ...item.data() } as FamilyBookUpload))
        uploads[child.childId].forEach((item) => resumeFamilyBookTransfer(familyId, child.childId, item))
        ready.add(`uploads:${child.childId}`); emit()
      }, fail))
      stops.push(onSnapshot(collection(db, 'families', familyId, 'children', child.childId, 'bookRequirements'), { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.metadata?.fromCache) return
        requirements[child.childId] = snapshot.docs.map((item) => ({ childId: child.childId, ...item.data() } as BookRequirement))
        ready.add(`requirements:${child.childId}`); emit()
      }, fail))
      }
      emit()
    }).catch((cause: unknown) => { if (active) fail(cause instanceof Error ? cause : new Error(String(cause))) })
    return () => { active = false; window.removeEventListener('online', retryOnReconnect); if (retryTimer !== undefined) window.clearTimeout(retryTimer); stops.forEach((stop) => stop()) }
  }, [familyId, children, retry])
  return state
}
