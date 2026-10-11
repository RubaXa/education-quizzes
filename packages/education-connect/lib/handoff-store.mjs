import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore'

/** Public Firebase project identifiers are not credentials.
 * @see ../../../docs/architecture/school-diary-port-adapter.md#family-onboarding-research
 */
const app = initializeApp({
  apiKey: 'AIzaSyBwyDHPCu_uMIpYZJa--F5F19ibqfo0sGw',
  authDomain: 'education-9d7c6.firebaseapp.com',
  projectId: 'education-9d7c6',
  appId: '1:631735202698:web:edf598314e691d1f5dce73',
})
const db = getFirestore(app)

async function anonymousSession() {
  const auth = getAuth(app)
  await auth.authStateReady()
  return auth.currentUser ?? (await signInAnonymously(auth)).user
}

export async function loadInvite(code) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('Неверный код приглашения')
  await anonymousSession()
  const snapshot = await getDoc(doc(db, 'connectionInvites', code))
  const data = snapshot.data()
  if (!snapshot.exists() || data?.status !== 'open' || !data.publicKey || !data.expiresAt || data.expiresAt.toMillis() <= Date.now()) {
    throw new Error('Приглашение закрыто или срок действия истёк')
  }
  return { publicKey: data.publicKey }
}

export async function submitHandoff(code, envelope) {
  await anonymousSession()
  await setDoc(doc(db, 'connectionInvites', code, 'handoff', 'current'), {
    ...envelope,
    submittedAt: serverTimestamp(),
  })
}
