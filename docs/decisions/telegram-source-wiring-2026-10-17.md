---
id: decision.telegram-source-wiring-2026-10-17
status: accepted
implementation: not-applicable
created: 2026-10-17
updated: 2026-10-17
parent: service.telegram-bot
uses:
  - service.telegram-bot.ports-and-events
  - service.telegram-bot.firestore
  - service.telegram-bot.mesh
  - service.telegram-bot.operations
consumers:
  - Telegram developer
  - Technical lead
  - Bot operator
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Firestore и МЭШ: подключение изменений к Telegram

## Основание

Пользователь прямо поручил следующий этап: подключить Firestore, затем МЭШ через Luna Worker, проверить результат, добавить тесты, обновить спецификации и выполнить commit/push. Последующее уточнение отменяет ручной список семей/детей: система должна автоматически принимать новые подключения и расширяться без изменения конфигурации. Это заменяет прежнюю идею семейного allowlist, включая rollout.

## Было → стало

Foundation обрабатывал только вручную переданные normalized events/существующий outbox. Новые source adapters дают безопасные observations, общий pipeline сохраняет durable sequence/pending, coordinator автоматически обнаруживает Education registry, запускает listeners/pollers, повторяет неполные наблюдения и снимает отозванные scopes. Базовые инварианты: первый historical snapshot тихий; shadow/notify раздельны; pending replay имеет прежние event IDs; отсутствие записи не доказывает отмену; доступ проверяется повторно перед приёмом события и отправкой. Количество семей/детей не ограничивается operator списком или limit query без pagination. Технические concurrency/page size регулируют нагрузку, все страницы проходят до конца.

МЭШ переиспользует существующий MeshDiaryAdapter. Учётные данные выбираются адресно по sourceAccount и actor hash; профиль ребёнка подтверждается отдельно, refresh атомарно сохраняет только общие tokens с mode0600. Один выбранный account на ребёнка исключает дубли источников; внутри процесса его запросы сериализованы. Schedule/homework имеют дневные checkpoints, grades — подтверждённые периодные области. Появление календарной области даёт baseline, а не историческую рассылку.

Новые файлы не меняют согласованный UI. Production host/IAM/index deployment, реальная API проверка, issuer/UI семейной привязки, grouped/team digest, межпроцессная credential lease и распределённый rate limiter остаются открытыми. Текущий inventory выполняет полную пагинированную сверку: отсутствие продуктового cap не означает доказанную неограниченную производительность одного процесса.

## Действия и роли

Luna Workers реализуют source pipeline/checkpoints, dynamic inventory/coordinator/runtime и Mesh normalization/credential resolver. Технический лидер проверяет границы по реальным моделям Education/SDK, возвращает на исправление недиагностичные тесты (cache eviction проверен RED size2 → GREEN size1), отдельно поручает Luna независимое чтение кода, воспроизводит проверки и обновляет граф контрактов. Данные реальных семей, секреты и credentials в fixtures/Git не включаются; проверки используют синтетические snapshots и transport fakes.

## Проверки

Регрессии охватывают pagination нескольких семей, подключение/отключение ребёнка без restart, exact owner/source identity, частичные ответы и ошибки отдельных семей, phase-only quiz events, safe field masks, silent bootstrap/shadow, pending crash/replay, scope leases/heartbeat/fencing, fair queue/retry/shutdown, Mesh semantic hashes и изоляцию детских профилей. Отдельные integration fixtures проходят source → pipeline → NotificationService → memory ledger/outbox → renderer → fake delivery. Полный gate: `npm run check`; staged documentation/privacy/whitespace hooks; перед push privacy history и повторный check. Полный `npm run check` прошёл:622 tests в134 файлах,147 спецификаций и420 классифицированных read sites; lint без ошибок (прежние warnings в незатронутом UI остаются). Сборка сайта пропущена по неизменному frontend fingerprint. Live SDK/API, production IAM и доставка реальным пользователям не запускались.

Затронутые runtime-файлы:

- `packages/telegram-notifications/adapters/config.mjs`
- `packages/telegram-notifications/adapters/runtime.mjs`
- `packages/telegram-notifications/adapters/worker-loop.mjs`
- `packages/telegram-notifications/domain/diff.mjs`
- `packages/telegram-notifications/domain/ports.mjs`
- `scripts/telegram-bot.mjs`
- `packages/telegram-notifications/adapters/mesh-credentials.mjs`
- `packages/telegram-notifications/adapters/source-checkpoint-firestore.mjs`
- `packages/telegram-notifications/adapters/source-coordinator.mjs`
- `packages/telegram-notifications/adapters/source-discovery-firestore.mjs`
- `packages/telegram-notifications/adapters/source-firestore.mjs`
- `packages/telegram-notifications/adapters/source-inventory-firestore.mjs`
- `packages/telegram-notifications/adapters/source-mesh.mjs`
- `packages/telegram-notifications/application/source-pipeline.mjs`

## Согласование

Прямой запрос: «Давай следующий этап: подключаем источники изменений к боту, сначала Firestore, потом МЭШ. Реализацию делай через Luna Worker, сам проверяй результат. Добавьте тесты, обновите спецификации, прогоните проверки и сделайте коммит с пушем». Уточнение: «У нас не должно быть ограничений, никаких на какой-то список детей… дальше подключать бесконечное количество новых семей». Флаги источников управляют способностью runtime, а не списком семей. Секреты не читаются в ходе разработки; live worker/доставка для проверки не запускались. Исходный UI baseline неизменен; проверенные backend hashes фиксируются отдельным accepted decision record.
