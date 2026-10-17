import { Firestore } from '@google-cloud/firestore'
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

/** @see ../../../docs/services/telegram-bot/README.md @see ../../../docs/services/telegram-bot/operations.md#runtime-boundary */
export function createRuntime(config, { logger = console, linkAuthorizer = null, firestore = null,
  enableFirestoreSource = false, enableMeshSource = false, enableDelivery = false, random = Math.random } = {}) {
  const db = firestore ?? new Firestore({ projectId: config.projectId })
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
  })
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
    }
    if (enableMeshSource) {
      const resolver = createMeshCredentialResolver({ db, connectionsDir: config.meshConnectionDirectory })
      meshSource = createMeshSourceAdapter({ resolver, pollMs: config.meshPollMs ?? 15 * 60_000, random,
        onHealth: ({ scopeKey, code }) => logger.error({ code: 'mesh_observation_unavailable', source: 'mesh',
          ...(typeof scopeKey === 'string' && /^[a-f0-9]{64}$/.test(scopeKey) ? { scopeKey } : {}), errorCode: safeMeshErrorCode(code) }) })
      sources.push(meshSource)
      pipelines.mesh = new SourcePipeline({ source: meshSource, checkpoints: createFirestoreSourceCheckpointStore(db),
        accept: (event) => notificationService.accept(event), mode: enableDelivery ? 'notify' : 'shadow',
        workerId: config.instanceId, clock })
    }
    const inventory = createFirestoreSourceInventory(db, { pageSize: config.sourcePageSize ?? 250,
      includeFirestore: enableFirestoreSource, includeMesh: enableMeshSource, meshSource })
    sourceCoordinator = new SourceCoordinator({ sources, pipelines,
      enumerate: () => inventory.enumerate(), discoveryStore: createFirestoreSourceDiscoveryStore(db, {
        namespace: enableDelivery ? 'notify' : 'shadow', scopeKey: (kind, scope) => sources.find((source) => source.kind === kind)?.scopeKey(scope),
      }),
      onHealth: (event) => logger.error(event), reconcileMs: config.sourceReconcileMs ?? 30_000,
      concurrency: config.sourceConcurrency ?? 4, random })
  }
  return { db, adapters, identity, telegram, notificationService, sourceCoordinator, verifyFirestore }
}

function safeMeshErrorCode(value) {
  const allowed = new Set(['scope_unavailable', 'credentials_unavailable', 'credentials_mismatch', 'mesh_unavailable',
    'mesh_access_unverified', 'child_profile_unavailable', 'scope_changed', 'credential_refresh_invalid',
    'credential_refresh_persist_failed', 'mesh_incomplete'])
  return allowed.has(value) ? value : 'mesh_unavailable'
}
