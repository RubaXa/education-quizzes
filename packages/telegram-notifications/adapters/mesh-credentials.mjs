import { createMeshSessionService } from '../../education-runtime/mesh-session.mjs'

/** Telegram compatibility port over the shared strict Mesh session service.
 * @see ../../../docs/services/telegram-bot/adapters/mesh.md#автоматическая-семейная-адресация
 */
export function createMeshCredentialResolver({ db, connectionsDir, fs, adapterFactory, telemetry = null, legacyCodec = null,
  shutdownSignal = null } = {}) {
  const sessions = createMeshSessionService({ db, connectionsDir, fs, adapterFactory, telemetry, legacyCodec, shutdownSignal })
  return Object.freeze({ validateScope: sessions.validateScope,
    withChildAdapter(scope, run, options = {}) {
      const explicitLegacyOwner = !sessions.credentials.hasCanonical(scope?.sourceAccountId)
        && legacyCodec?.matches?.(scope?.sourceAccountId, { kind: 'legacy', accountId: scope?.sourceAccountId,
          familyId: scope?.familyId, childId: scope?.childId })
        ? { kind: 'legacy', accountId: scope.sourceAccountId, familyId: scope.familyId, childId: scope.childId } : null
      return sessions.withChildAdapter(scope, run, { ...options, ...(explicitLegacyOwner ? { legacyOwner: explicitLegacyOwner } : {}) })
    },
    resolveLocalSourceOwner: sessions.resolveLocalSourceOwner })
}
