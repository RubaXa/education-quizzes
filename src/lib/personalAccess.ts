import { getAuth, signInAnonymously } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'

/** @see ../../docs/architecture/family-data-model.md#link-login */
export type PersonalSession = { personId: string; deviceUid: string; linkToken: string }
export type PersonalChild = {
  familyId: string
  childId: string
  displayName: string
  role: 'parent' | 'student'
  dashboardToken?: string
  dayToken?: string
}
export type PersonalProfile = {
  personId: string
  displayName: string
  children: PersonalChild[]
}

let activeSession: PersonalSession | null = null
let pendingRedemption: { linkToken: string; promise: Promise<PersonalSession> } | null = null
const secretPattern = /^[A-Za-z0-9_-]{43}$/

export function currentEducationPersonId(): string {
  if (!activeSession || getAuth().currentUser?.uid !== activeSession.deviceUid) {
    throw new Error('Откройте личную ссылку Education.')
  }
  return activeSession.personId
}

export function secretFromPersonalLink(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Ссылка не найдена. Скопируйте личную ссылку родителя или ребёнка и попробуйте снова.')
  if (secretPattern.test(trimmed)) return trimmed
  let hash = trimmed
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed)
    const allowedOrigin = url.origin === 'https://rubaxa.github.io' || url.origin === location.origin
    if (!allowedOrigin || !/^\/education-quizzes\/?$/.test(url.pathname)) {
      throw new Error('Это ссылка на другой сайт. Нужна личная ссылка Education.')
    }
    hash = url.hash
  }
  const secret = hash.match(/^#\/enter\/([A-Za-z0-9_-]{43})$/)?.[1]
  if (secret) return secret
  if (/^#\/(day|day-parent|days|days-parent)\//.test(hash)) {
    throw new Error('Это ссылка на учебный день, а для входа в приложение нужна личная ссылка профиля. Откройте личную ссылку родителя или ребёнка.')
  }
  if (/^#\/(t|preview|dashboard|my|review)\//.test(hash)) {
    throw new Error('Это ссылка на тест или список заданий. Для входа в приложение нужна личная ссылка профиля.')
  }
  throw new Error('В ссылке нет личного входа Education. Она должна содержать #/enter/ после адреса сайта.')
}

/** A pasted value must be the complete personal URL, not an ambiguous bare token. */
export function secretFromPastedPersonalLink(value: string): string {
  const trimmed = value.trim()
  if (secretPattern.test(trimmed)) throw new Error('В буфере только код ссылки. Скопируйте личную ссылку Education целиком.')
  if (trimmed && !/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('#/')) {
    throw new Error('В буфере нет ссылки Education. Скопируйте личную ссылку профиля целиком.')
  }
  return secretFromPersonalLink(trimmed)
}

async function authUid(): Promise<string> {
  const auth = getAuth()
  await auth.authStateReady()
  if (auth.currentUser) return auth.currentUser.uid
  return (await signInAnonymously(auth)).user.uid
}

async function sessionFromGrant(linkToken: string, deviceUid: string): Promise<PersonalSession> {
  const grant = await getDoc(doc(db, 'accessLinks', linkToken))
  const personId = grant.data()?.personId
  if (!grant.exists() || grant.data()?.active !== true || typeof personId !== 'string') {
    throw new Error('Личная ссылка закрыта. Попросите новую ссылку.')
  }
  activeSession = { personId, deviceUid, linkToken }
  return activeSession
}

/** @see ../../docs/product/pwa.md#install */
export function personalEntryUrl(session: PersonalSession): string {
  return `${location.origin}${import.meta.env.BASE_URL}#/enter/${session.linkToken}`
}

/** A link is a bearer credential. Its grant is checked again by Firestore rules on every read. */
export async function redeemPersonalLink(value: string): Promise<PersonalSession> {
  const linkToken = secretFromPersonalLink(value)
  if (pendingRedemption?.linkToken === linkToken) return pendingRedemption.promise
  const promise = (async () => {
    const deviceUid = await authUid()
    const reference = doc(db, 'deviceSessions', deviceUid)
    const previous = await getDoc(reference)
    await setDoc(reference, {
      linkToken,
      createdAt: previous.exists() ? previous.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return sessionFromGrant(linkToken, deviceUid)
  })()
  pendingRedemption = { linkToken, promise }
  try { return await promise }
  finally { if (pendingRedemption?.promise === promise) pendingRedemption = null }
}

/** @see ../../docs/architecture/family-data-model.md#authorization */
export async function restorePersonalSession(): Promise<PersonalSession | null> {
  const auth = getAuth()
  await auth.authStateReady()
  const deviceUid = auth.currentUser?.uid
  if (!deviceUid) return null
  const snapshot = await getDoc(doc(db, 'deviceSessions', deviceUid))
  const linkToken = snapshot.data()?.linkToken
  if (!snapshot.exists() || typeof linkToken !== 'string' || !secretPattern.test(linkToken)) return null
  return sessionFromGrant(linkToken, deviceUid)
}

/** @see ../../docs/architecture/family-data-model.md#collections */
export async function loadPersonalProfile(session: PersonalSession): Promise<PersonalProfile> {
  const person = await getDoc(doc(db, 'users', session.personId))
  if (!person.exists()) throw new Error('Профиль ещё не опубликован.')
  const displayName = person.data().displayName
  if (typeof displayName !== 'string') throw new Error('У профиля нет имени.')
  const families = await getDocs(collection(db, 'users', session.personId, 'families'))
  const children: PersonalChild[] = []
  for (const family of families.docs) {
    const familyId = family.id
    const member = await getDoc(doc(db, 'families', familyId, 'members', session.personId))
    const role = member.data()?.role
    const childIds = member.data()?.childIds
    if (!member.exists() || member.data()?.active !== true ||
      (role !== 'parent' && role !== 'student') || !Array.isArray(childIds)) continue
    for (const childId of childIds) {
      if (typeof childId !== 'string') continue
      const [child, shortcut] = await Promise.all([
        getDoc(doc(db, 'families', familyId, 'children', childId)),
        getDoc(doc(db, 'users', session.personId, 'families', familyId, 'shortcuts', childId)),
      ])
      if (!child.exists()) continue
      children.push({
        familyId, childId, role,
        displayName: typeof child.data().displayName === 'string' ? child.data().displayName : 'Ученик',
        dashboardToken: typeof shortcut.data()?.dashboardToken === 'string' ? shortcut.data()?.dashboardToken : undefined,
        dayToken: typeof shortcut.data()?.dayToken === 'string' ? shortcut.data()?.dayToken : undefined,
      })
    }
  }
  return { personId: session.personId, displayName, children }
}
