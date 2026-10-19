import { createEducationFirestore } from '../../education-runtime/firestore.mjs'
import { createFirestoreAdapters } from './firestore.mjs'
import { createTelegramAdapter, createTelegramDelivery } from './telegram.mjs'
import { IdentityService } from '../application/identity.mjs'
import { NotificationService } from '../application/notifications.mjs'
import { renderNotificationParts } from '../domain/renderer.mjs'
import { SourcePipeline } from '../application/source-pipeline.mjs'
import { createFirestoreSourceAdapter } from './source-firestore.mjs'
import { createFirestoreSourceCheckpointStore } from './source-checkpoint-firestore.mjs'
import { createFirestoreSourceInventory } from './source-inventory-firestore.mjs'
import { SourceCoordinator } from './source-coordinator.mjs'
import { createMeshSourceAdapter } from './source-mesh.mjs'
import { createMeshCredentialResolver } from './mesh-credentials.mjs'
import { createHash } from 'node:crypto'
import { EducationSyncDispatcher, createFirestoreEducationSyncStore } from '../application/education-sync-dispatcher.mjs'
import { withOperationDeadline } from '../operations/operation-deadline.mjs'
import { EducationEventConsumer, createFirestoreEducationEventStore, publishEducationEvent } from '../../education-runtime/event-queue.mjs'
import { createEducationEventHandlers } from '../application/education-event-routing.mjs'
import { createUploadBroker } from '../../education-runtime/upload-broker.mjs'
import { createLegacyEducationEventReconciler } from '../../education-runtime/legacy-event-reconciliation.mjs'

/** @see ../../../docs/shared/server-runtime.md @see ../../../docs/services/telegram-bot/README.md @see ../../../docs/services/telegram-bot/operations.md#runtime-boundary */
export function createRuntime(config, { logger = console, linkAuthorizer = null, firestore = null,
  enableFirestoreSource = false, enableMeshSource = false, enableDelivery = false, random = Math.random,
  telemetry = null, legacyCodec = null, shutdownSignal = null,
  uploadDisk = null, uploadReconciliation = {},
  educationSyncDispatcherFactory = (options) => new EducationSyncDispatcher(options) } = {}) {
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
    renderer: renderNotificationParts,
    delivery: createTelegramDelivery(config.token),
    clock,
    logger,
    workerId: config.instanceId,
    telemetry,
  })
  let workerWakeDelivery = () => {}
  let workerWakeEducationSync = () => {}
  wrapMethod(notificationService, 'accept', telemetry, 'telegram.notification.accept', (event) => ({
    eventId: event?.eventId, scopeHash: opaqueHash(`${event?.familyId ?? ''}/${event?.childId ?? ''}`),
  }))
  wrapMethod(notificationService, 'runOne', telemetry, 'telegram.notification.run-one', undefined, 'trace')
  wrapMethod(notificationService.delivery, 'send', telemetry, 'telegram.delivery.send')
  const educationSyncDispatcher = config.educationSync && (enableMeshSource || enableFirestoreSource) && enableDelivery
    ? educationSyncDispatcherFactory({ db, store: createFirestoreEducationSyncStore(db), threadId: config.educationSync.threadId,
      codexPath: config.educationSync.codexPath, projectRoot: config.educationSync.projectRoot, remote: config.educationSync.remote }) : null
  if (educationSyncDispatcher) wrapMethod(educationSyncDispatcher, 'runOne', telemetry, 'telegram.education-sync.dispatch')
  const uploadBroker = uploadDisk ? createUploadBroker({ db, disk: uploadDisk, logger: (event) => logger.error(event),
    reconciliation: uploadReconciliation }) : null
  if (educationSyncDispatcher) wrapMethod(educationSyncDispatcher, 'enqueueAction', telemetry, 'telegram.education-sync.action-prepare',
    (event) => ({ eventType: event?.eventType }))
  if (uploadBroker?.reconciler) wrapMethod(uploadBroker.reconciler, 'runOne', telemetry, 'telegram.upload.reconcile')
  const legacyEventReconciler = enableDelivery ? createLegacyEducationEventReconciler({ db,
    logger: (event) => logger.error(event) }) : null
  if (legacyEventReconciler) wrapMethod(legacyEventReconciler, 'runOne', telemetry, 'telegram.education-event.legacy-reconcile')
  let sourceCoordinator = null
  const firestoreSource = enableFirestoreSource ? createFirestoreSourceAdapter(db) : null
  const firestorePipeline = firestoreSource ? new SourcePipeline({ source: firestoreSource, checkpoints: createFirestoreSourceCheckpointStore(db),
    accept: async (event) => {
      const result = await notificationService.accept(event)
      if (result?.created && result.queued > 0 && result.nextDueAt) workerWakeDelivery(result.nextDueAt)
      return result
    }, mode: enableDelivery ? 'notify' : 'shadow', workerId: config.instanceId, clock }) : null
  if (firestorePipeline) wrapMethod(firestorePipeline, 'process', telemetry, 'telegram.source-pipeline.process', (scope) => ({
    source: 'firestore', scopeHash: firestorePipeline.source.scopeKey(scope),
  }), 'trace')

  let meshSource = null
  let meshPipeline = null
  if (enableMeshSource) {
    const resolver = createMeshCredentialResolver({ db, connectionsDir: config.meshConnectionDirectory, telemetry, legacyCodec, shutdownSignal })
    meshSource = createMeshSourceAdapter({ resolver, pollMs: config.meshPollMs ?? 15 * 60_000, random,
      onHealth: ({ scopeKey, code }) => logger.error({ code: 'mesh_observation_unavailable', source: 'mesh',
        ...(typeof scopeKey === 'string' && /^[a-f0-9]{64}$/.test(scopeKey) ? { scopeKey } : {}), errorCode: safeMeshErrorCode(code) }) })
    meshPipeline = new SourcePipeline({ source: meshSource, checkpoints: createFirestoreSourceCheckpointStore(db),
      accept: async (event) => publishEducationEvent(db, {
        source: 'mesh', sourceRef: { kind: 'mesh', documentPath: `meshEvents/${event.scopeKey}/${event.sourceEventKey}` },
        familyId: event.familyId, childId: event.childId, actor: { type: 'system', id: 'mesh' },
        operationId: event.sourceRevision, eventType: event.eventType, payload: event,
      }), mode: enableDelivery ? 'notify' : 'shadow', workerId: config.instanceId, clock })
    wrapMethod(meshPipeline, 'process', telemetry, 'telegram.source-pipeline.process', (scope) => ({
      source: 'mesh', scopeHash: meshPipeline.source.scopeKey(scope),
    }), 'trace')
    const inventory = createFirestoreSourceInventory(db, { pageSize: config.sourcePageSize ?? 250, telemetry,
      includeFirestore: false, includeMesh: true, meshSource })
    const meshCoordinator = new SourceCoordinator({ sources: [meshSource], pipelines: { mesh: meshPipeline },
      enumerate: ({ signal } = {}) => inventory.enumerate({ signal }),
      onHealth: (event) => logger.error(event), reconcileMs: config.sourceReconcileMs ?? 30_000,
      concurrency: config.sourceConcurrency ?? 4, random })
    const reconcile = meshCoordinator.reconcile
    meshCoordinator.reconcile = withOperationDeadline(reconcile, {
      timeoutMs: config.sourceOperationTimeoutMs ?? 600_000, operation: 'source_reconcile',
      onTimeout: () => { logger.error({ code: 'source_operation_timeout', source: 'mesh' }); process.exit(1) },
    })
    sourceCoordinator = meshCoordinator
    wrapMethod(sourceCoordinator, 'reconcile', telemetry, 'telegram.source-coordinator.reconcile', () => ({ source: 'mesh' }), 'trace')
    wrapMethod(sourceCoordinator, 'signal', telemetry, 'telegram.source-coordinator.signal', (_kind, scope) => ({
      source: 'mesh', scopeHash: opaqueHash(`${scope?.familyId ?? ''}/${scope?.childId ?? ''}`),
    }))
  }

  const educationEventStore = enableDelivery ? createFirestoreEducationEventStore(db) : null
  if (educationEventStore) {
    wrapMethod(educationEventStore, 'listReady', telemetry, 'telegram.education-event.list-ready')
    wrapMethod(educationEventStore, 'claim', telemetry, 'telegram.education-event.claim', (input) => ({
      eventIdHash: opaqueHash(input?.eventId ?? ''),
    }))
  }
  const educationEventConsumer = enableDelivery ? new EducationEventConsumer({
    store: educationEventStore,
    handlers: createEducationEventHandlers({ firestorePipeline, notificationService, educationSyncDispatcher,
      onDeliveryQueued: (dueAt) => workerWakeDelivery(dueAt), onEducationSyncQueued: (dueAt) => workerWakeEducationSync(dueAt),
      actionHandlers: { ...(uploadBroker?.handlers ?? {}), ...(config.educationEventHandlers ?? {}) } }),
    workerId: config.instanceId, clock, leaseMs: config.educationEventLeaseMs ?? 120_000, concurrency: config.eventConcurrency ?? 4,
    onReady: ({ subscriptionCount }) => logger.info?.({ code: 'education_event_queue_listening', source: 'educationEvents', subscriptionCount, processId: process.pid }),
    onError: (event) => logger.error(event),
  }) : null
  if (educationEventConsumer) wrapMethod(educationEventConsumer, 'runOne', telemetry, 'telegram.education-event.run-one')
  if (sourceCoordinator) {
    for (const [method, operation] of [['start', 'source_start'], ['reconcile', 'source_reconcile']]) {
      const original = sourceCoordinator[method]
      if (typeof original === 'function') sourceCoordinator[method] = withOperationDeadline(original, {
        timeoutMs: config.sourceOperationTimeoutMs ?? 600_000, operation,
        onTimeout: () => { logger.error({ code: 'source_operation_timeout' }); process.exit(1) },
      })
    }
    for (const pipeline of Object.values(sourceCoordinator.pipelines ?? {})) {
      const original = pipeline?.process
      if (typeof original === 'function') pipeline.process = withOperationDeadline(original, {
        timeoutMs: config.sourceOperationTimeoutMs ?? 600_000, operation: 'source_pipeline',
        onTimeout: () => { logger.error({ code: 'source_operation_timeout' }); process.exit(1) },
      })
    }
    wrapMethod(sourceCoordinator, 'reconcile', telemetry, 'telegram.source-coordinator.reconcile', undefined, 'trace')
    wrapMethod(sourceCoordinator, 'signal', telemetry, 'telegram.source-coordinator.signal', (_kind, scope) => ({
      source: _kind, scopeHash: opaqueHash(`${scope?.familyId ?? ''}/${scope?.childId ?? ''}`),
    }))
  }
  return { db, adapters, identity, telegram, notificationService, sourceCoordinator, educationSyncDispatcher, educationEventConsumer,
    firestorePipeline, uploadReconciler: uploadBroker?.reconciler ?? null, legacyEventReconciler, verifyFirestore,
    setWorkerWakeHandlers({ delivery = () => {}, educationSync = () => {} } = {}) {
      workerWakeDelivery = delivery
      workerWakeEducationSync = educationSync
    } }
}

export function createSourceCoordinatorFacade({ firestoreCoordinator, meshCoordinator }) {
  const coordinators = [firestoreCoordinator, meshCoordinator].filter(Boolean)
  const byKind = new Map()
  for (const coordinator of coordinators) for (const kind of coordinator.sources.keys()) byKind.set(kind, coordinator)
  const facade = {
    sources: new Map(coordinators.flatMap((coordinator) => [...coordinator.sources])),
    pipelines: Object.assign({}, ...coordinators.map((coordinator) => coordinator.pipelines)),
    async start() {
      if (!firestoreCoordinator) return meshCoordinator?.start()
      const meshStart = meshCoordinator?.start()
      if (meshStart) void meshStart.catch(() => {})
      return firestoreCoordinator.start()
    },
    async reconcile() {
      if (!firestoreCoordinator) return meshCoordinator?.reconcile()
      const meshReconcile = meshCoordinator?.reconcile()
      if (meshReconcile) void meshReconcile.catch(() => {})
      return firestoreCoordinator.reconcile()
    },
    signal(kind, scope, options) { return byKind.get(kind)?.signal(kind, scope, options) ?? false },
    async close() {
      const results = await Promise.allSettled(coordinators.map((coordinator) => coordinator.close()))
      if (results.some((result) => result.status === 'rejected')) throw new Error('source_stop_failed')
    },
  }
  return facade
}

function wrapMethod(target, name, telemetry, operation, attrs = () => ({}), kind = 'span') {
  if (typeof target?.[name] !== 'function' || !telemetry?.span) return
  const operationDeadline = target[name].__operationDeadline === true
  const original = target[name].bind(target)
  const wrapped = (...args) => (kind === 'trace' && telemetry.trace ? telemetry.trace : telemetry.span)(operation,
    () => original(...args), attrs(...args))
  if (operationDeadline) Object.defineProperty(wrapped, '__operationDeadline', { value: true })
  target[name] = wrapped
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
