---
id: decision.shared-server-runtime-2026-10-17
status: accepted
implementation: not-applicable
created: 2026-10-17
updated: 2026-10-17
parent: shared.server-runtime
uses:
  - service.telegram-bot
  - service.operator-cli
  - module.synchronization
consumers:
  - Technical lead
  - UI gate
  - Runtime maintainer
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Общее серверное ядро, telemetry и постоянный Telegram runtime

## Основание

Пользователь17.10 прямо запросил реальную Firestore/МЭШ→Telegram цепочку, нагрузочную проверку, постоянную работу, реализацию через Luna с ревью техлида и commit/push. Дополнительное требование: существующий education-sync и бот используют общие механизмы/ядро без дублирования, подключаемые adapters и измеряемое время этапов. Исходная ревизия описана в [аудите](../audits/server-core-review-2026-10-17.md).

## Было → стало

Два source consumers использовали общий Mesh SDK, но отдельные inventory/credential/authorization bootstrap paths. Shared server runtime выделяет общие механизмы, сохраняя разные application effects. Telemetry имеет единую схему и безопасный exporter. Operational probes явно технические; фиктивные учебные изменения не создаются. Постоянная работа проверяется отдельно от наличия кода.

## Действия и роли

Luna реализует общее IO/session ядро, telemetry/benchmark и operational tooling крупными согласованными slices. Техлид определяет границы, сверяет фактические consumers, проверяет tests/evidence и реальные операции через штатные команды. Семейный доступ не подменяется ручной записью links; отсутствие подтверждения пользователя явно блокирует отправку.

## Проверки

Общий gate `npm run check`, contract/parity/isolated-family/revocation/refresh/cross-process tests, telemetry redaction/rotation, deterministic fake-load с измеренным отчётом, реальные ограниченные probes/readback и host status. Итог:722 tests/149files,150 спецификаций,451 read site; live getMe/Firestore/Mesh read и обе technical probes sent/receipt1 подтверждены, оба outbox indexes READY, Mac LaunchAgent running/readiness readyForDelivery. Полный Mesh охват partial90/93;3 schedule_date_mismatch не продвигают baseline. UI baseline неизменен.

## Согласование

Прямое разрешение пользователя включает текущие refactor, tests, реальную интеграционную проверку, постоянную установку процесса и commit/push. Новые Firebase/Telegram операции выполняются штатными инструментами с явным apply и квитанцией; load использует synthetic IO. Секреты и семейные артефакты хранятся только в закрытом runtime/рабочем каталоге. Никакого нового PWA экрана этот increment не добавляет.

### Затронутые файлы

- `operator/run-operation.mjs`
- `packages/education-connect/lib/mesh.mjs`
- `packages/education-connect/lib/network-retry.mjs`
- `packages/education-runtime/credentials.mjs`
- `packages/education-runtime/family-graph.mjs`
- `packages/education-runtime/firestore.mjs`
- `packages/education-runtime/identity.mjs`
- `packages/education-runtime/mesh-session.mjs`
- `packages/education-runtime/telemetry.mjs`
- `packages/telegram-notifications/adapters/config.mjs`
- `packages/telegram-notifications/adapters/firestore.mjs`
- `packages/telegram-notifications/adapters/memory.mjs`
- `packages/telegram-notifications/adapters/mesh-credentials.mjs`
- `packages/telegram-notifications/adapters/probe-recipient-firestore.mjs`
- `packages/telegram-notifications/adapters/runtime.mjs`
- `packages/telegram-notifications/adapters/source-coordinator.mjs`
- `packages/telegram-notifications/adapters/source-discovery-firestore.mjs`
- `packages/telegram-notifications/adapters/source-inventory-firestore.mjs`
- `packages/telegram-notifications/adapters/source-mesh.mjs`
- `packages/telegram-notifications/adapters/telegram.mjs`
- `packages/telegram-notifications/adapters/worker-loop.mjs`
- `packages/telegram-notifications/application/identity.mjs`
- `packages/telegram-notifications/application/notifications.mjs`
- `packages/telegram-notifications/application/probe-notifications.mjs`
- `packages/telegram-notifications/application/source-pipeline.mjs`
- `packages/telegram-notifications/domain/diff.mjs`
- `packages/telegram-notifications/domain/events.mjs`
- `packages/telegram-notifications/domain/renderer.mjs`
- `packages/telegram-notifications/operations/launch-agent.mjs`
- `packages/telegram-notifications/operations/private-logger.mjs`
- `packages/telegram-notifications/operations/probe-runner.mjs`
- `packages/telegram-notifications/operations/probe-source.mjs`
- `packages/telegram-notifications/operations/probe-target.mjs`
- `packages/telegram-notifications/operations/process-lock.mjs`
- `packages/telegram-notifications/operations/readiness.mjs`
- `packages/telegram-notifications/operations/source-check.mjs`
- `scripts/benchmark-server-runtime.mjs`
- `scripts/lib/admin-firebase.mjs`
- `scripts/sync-project.mjs`
- `scripts/telegram-bot.mjs`
- `scripts/telegram-indexes.mjs`
- `scripts/telegram-pair.mjs`
- `scripts/telegram-runtime.mjs`
- `sync/project-plan.mjs`
- `sync/run-context.mjs`
