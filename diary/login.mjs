/** Direct local login, without invitations or cloud handoff.
 * @see ../docs/decisions/mesh-http-trace-2026-11-02.md */
export async function localMeshLogin({ login, Adapter, readCredentials, askSmsCode, chooseProfile, save,
  onProgress, onDiagnostic, trace, expectedActorPersonId }) {
  const result = await login({ readCredentials, askSmsCode, chooseProfile, onProgress, onDiagnostic, trace, expectedActorPersonId })
  const { profileName, ...credentials } = result
  // Validate in memory. A failed verification must leave the existing local source untouched.
  let confirmed = credentials
  const adapter = new Adapter(credentials, updated => { confirmed = updated }, { trace })
  const verified = await adapter.verifyAccess()
  if (expectedActorPersonId && String(confirmed.actorPersonId) !== String(expectedActorPersonId)) {
    throw new Error('ACCESS_NOT_VERIFIED: вход выполнен другим родителем; прежнее подключение сохранено')
  }
  save(confirmed)
  return { profileName, verified }
}
