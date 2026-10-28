/** @see ../../docs/modules/school-diary/school-calendar.md#представление */
export function getAuth() {
  return { currentUser: { uid: 'playwright-fixture' }, authStateReady: async () => undefined }
}
export function signInAnonymously() { return Promise.resolve({ user: { uid: 'playwright-fixture' } }) }
export function onAuthStateChanged() { return () => undefined }
