import { createEducationFirestore } from '../../education-runtime/firestore.mjs'
import { createFirestoreAdapters } from './firestore.mjs'
import { createTelegramAdapter, createTelegramDelivery } from './telegram.mjs'
import { IdentityService } from '../application/identity.mjs'
import { NotificationService } from '../application/notifications.mjs'
import { renderEvent } from '../domain/renderer.mjs'
import { SourcePipeline } from '../application/source-pipeline.mjs'
import { createFirestoreSourceAdapter } from './source-firestore.mjs'
import { createFirestoreSourceCheckpointStore } from './source-checkpoint-firestore.mjs'
import { createFirestoreSourceInventory } from './source-inventory-firestore.mjs'
import { createFirestoreSourceDiscoveryStore } from './source-discovery-firestore.mjs'
import { SourceCoordinator } from './source-coordinator.mjs'
import { createMeshSourceAdapter } from './source-mesh.mjs'
import { createMeshCredentialResolver } from './mesh-credentials.mjs'
import { createHash } from 'node:crypto'

/** @see ../../../docs/shared/server-runtime.md @see ../../../docs/services/telegram-bot/README.md @see ../../../docs/services/telegram-bot/operations.md#runtime-boundary */
export function createRuntime(config, { logger = console, linkAuthorizer = null, firestore = null,
  enableFirestoreSource = false, enableMeshSource = false, enableDelivery = false, random = Math.random,
  telemetry = null, legacyCodec = null, shutdownSignal = null } = {}) {
  const db = firestore ?? createEducationFirestore({ projectId: config.projectId, telemetry })
  const verifyFirestore = async () => {
    // A single non-sensitive document lookup resolves ADC/project access before polling.
    await db.doc(`telegramBotRuntimeChecks/${config.projectId}`).get()
  }
  const adapters = createFirestoreAdapters(db)
  const clock = () => new Date()
  const identity = new IdentityService({ registry: adapters.registry, linkAuthorizer, clock })
  const telegram = createTelegramAdapter({ token: config.token, identity, logger })
  const notificationService = new NotificationService({
    eventLedger: adapters.eventLedger,
    outbox: adapters.outbox,
    recipients: adapters.recipients,
    membership: adapters.membership,
    channel: adapters.channel,
    renderer: renderEvent,
    delivery: createTelegramDelivery(config.token),
    clock,
    logger,
    workerId: config.instanceId,
    telemetry,
  })
  wrapMethod(notificationService, 'accept', telemetry, 'telegram.notification.accept', (event) => ({
    eventId: event?.eventId, scopeHash: opaqueHash(`${event?.familyId ?? ''}/${event?.childId ?? ''}`),
  }))
  wrapMethod(notificationService, 'runOne', telemetry, 'telegram.notification.run-one', undefined, 'trace')
  wrapMethod(notificationService.delivery, 'send', telemetry, 'telegram.delivery.send')
  let sourceCoordinator = null
  if (enableFirestoreSource || enableMeshSource) {
    const sources = []
    const pipelines = {}
    let firestoreSource = null
    let meshSource = null
    if (enableFirestoreSource) {
      firestoreSource = createFirestoreSourceAdapter(db)
      sources.push(firestoreSource)
      pipelines.firestore = new SourcePipeline({ source: firestoreSource, checkpoints: createFirestoreSourceCheckpointStore(db),
        accept: (event) => notificationService.accept(event), mode: enableDelivery ? 'notify' : 'shadow',
        workerId: config.instanceId, clock })
      wrapMethod(pipelines.firestore, 'process', telemetry, 'telegram.source-pipeline.process', (scope) => ({
        source: 'firestore', scopeHash: pipelines.firestore.source.scopeKey(scope),
      }), 'trace')
    }
    if (enableMeshSource) {
      const resolver = createMeshCredentialResolver({ db, connectionsDir: config.meshConnectionDirectory, telemetry, legacyCodec, shutdownSignal })
      meshSource = createMeshSourceAdapter({ resolver, pollMs: config.meshPollMs ?? 15 * 60_000, random,
        onHealth: ({ scopeKey, code }) => logger.error({ code: 'mesh_observation_unavailable', source: 'mesh',
          ...(typeof scopeKey === 'string' && /^[a-f0-9]{64}$/.test(scopeKey) ? { scopeKey } : {}), errorCode: safeMeshErrorCode(code) }) })
      sources.push(meshSource)
      pipelines.mesh = new SourcePipeline({ source: meshSource, checkpoints: createFirestoreSourceCheckpointStore(db),
        accept: (event) => notificationService.accept(event), mode: enableDelivery ? 'notify' : 'shadow',
        workerId: config.instanceId, clock })
      wrapMethod(pipelines.mesh, 'process', telemetry, 'telegram.source-pipeline.process', (scope) => ({
        source: 'mesh', scopeHash: pipelines.mesh.source.scopeKey(scope),
      }), 'trace')
    }
    const inventory = createFirestoreSourceInventory(db, { pageSize: config.sourcePageSize ?? 250, telemetry,
      includeFirestore: enableFirestoreSource, includeMesh: enableMeshSource, meshSource })
    sourceCoordinator = new SourceCoordinator({ sources, pipelines,
      enumerate: ({ signal } = {}) => inventory.enumerate({ signal }), discoveryStore: createFirestoreSourceDiscoveryStore(db, {
        namespace: enableDelivery ? 'notify' : 'shadow', scopeKey: (kind, scope) => sources.find((source) => source.kind === kind)?.scopeKey(scope),
      }),
      onHealth: (event) => logger.error(event), reconcileMs: config.sourceReconcileMs ?? 30_000,
      concurrency: config.sourceConcurrency ?? 4, random })
  }
  if (sourceCoordinator) {
    wrapMethod(sourceCoordinator, 'reconcile', telemetry, 'telegram.source-coordinator.reconcile', undefined, 'trace')
    wrapMethod(sourceCoordinator, 'signal', telemetry, 'telegram.source-coordinator.signal', (_kind, scope) => ({
      source: _kind, scopeHash: opaqueHash(`${scope?.familyId ?? ''}/${scope?.childId ?? ''}`),
    }))
  }
  return { db, adapters, identity, telegram, notificationService, sourceCoordinator, verifyFirestore }
}

function wrapMethod(target, name, telemetry, operation, attrs = () => ({}), kind = 'span') {
  if (typeof target?.[name] !== 'function' || !telemetry?.span) return
  const original = target[name].bind(target)
  target[name] = (...args) => (kind === 'trace' && telemetry.trace ? telemetry.trace : telemetry.span)(operation,
    () => original(...args), attrs(...args))
}

function opaqueHash(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex')
}

function safeMeshErrorCode(value) {
  const allowed = new Set(['scope_unavailable', 'credentials_unavailable', 'credentials_mismatch', 'mesh_unavailable',
    'mesh_access_unverified', 'child_profile_unavailable', 'scope_changed', 'credential_refresh_invalid',
    'credential_refresh_persist_failed', 'mesh_incomplete'])
  return allowed.has(value) ? value : 'mesh_unavailable'
}
