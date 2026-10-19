---
id: decision.unified-education-events-2026-10-19
status: accepted
implementation: partial
created: 2026-10-19
updated: 2026-10-19
parent: module.synchronization
uses:
  - module.synchronization.event-queue
  - module.synchronization.execution-artifact
  - service.telegram-bot.education-sync-dispatch
  - service.upload-worker
consumers:
  - Education developer
  - deterministic dispatcher
  - EducationSync operator
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Единый вход событий Education

## Основание

Пользователь19.10 прямо отверг подписки на документы/коллекции как способ обнаружения действий и потребовал одну внутреннюю очередь, одну подписку и расширяемые обработчики любых действий системы. Предыдущее [решение о collection discovery](firestore-live-discovery-2026-10-19.md) отменено; факт его предыдущего выпуска сохраняется как история.

## Было → стало

Приложение и внешние source adapters публикуют стабильные action/revision envelopes в `educationEvents`. Источник действия и событие пишутся атомарно. Постоянный consumer подписан только на очередь, использует транзакционный claim/fencing и устойчивые fanout checkpoints. Скрипты передачи файлов подключаются как handlers того же consumer. Подтверждение байтов, хранение оригинала и педагогическая проверка — разные стадии; промежуточная загрузка не порождает ложную проверку или сообщение о сохранённой работе.

Старые открытые PWA ещё могут писать без события. Ограниченный reconciliation producer добавляет недостающие действия в ту же очередь без source subscriptions. Это переходная совместимость, а не альтернативная бизнес-очередь. Транспортный Telegram outbox и `operatorSyncJobs` сохраняют существующие роли доставки/исполнения.

Для поддержанных Firestore задач producer исполнения сохраняет закрытый неизменяемый пакет точного источника и задания. Dispatch фиксирует окно поколений и ссылки на конкретные задания; CLI выдаёт только закрытый путь и счётчики, полные входы записывает в приватные страницы манифеста. Свежий пакет не требует общего inbox scan. Устаревший пакет обновляется только по своим адресам; изменившийся вход нельзя выдать за старую готовую задачу. Полный Mesh execution artifact и полнота старых производителей проверяются отдельно; наличие очереди само по себе не означает их завершения.

## Действия и роли

Запросы помощи и продолжения теста создают адресную задачу. Переданные байты обрабатывает broker; только подтверждённый оригинал запускает проверку. Завершённые подсказки, решения об обязательности и опубликованные разборы не запускают новый LLM цикл. Членство и текущий owner проверяются на подготовке и публикации. UI сохраняет прежние карточки, роли и действия; меняется атомарность технической отправки события.

## Проверки

Обязательны детерминированные проверки identity, source+event atomicity, actor/scope, client update denial, разных действий одного задания, retry/fencing, порций и expired leases, единственной subscription, отключённых старых watchers, файлового checksum/авторизации, адресного задания/свежести и отсутствия рекурсивного LLM на готовый результат. Root проверяет работу Luna, полный `npm run check`, реестр чтений, контрактные fingerprints и git hooks. Rules-проверки здесь статические: Java/Firestore emulator недоступен; deploy compiler отдельно проверяет синтаксис, но не заменяет поведенческую проверку доступа. Выпуск требует main, Rules/индексов, producer приложения и установленного единого процесса; локальный тест не выдаётся за реальную доставку.

## Согласование

Прямое поручение пользователя: общая очередь с одной подпиской; реализация через Luna с проверкой root, тестами, спецификациями и выпуском в основной main. Сессия «Связать разбор с шагами решения» уведомлена о base49620f2 и затрагиваемых границах; её snapshot подтвердил отсутствие новых изменений. Root отвечает за единый выпуск Rules/индексов, Pages и Mac runtime. Прежний upload LaunchAgent останавливается после готовности нового consumer; PWA producer не считается доставленным всем уже открытым старым клиентам.

<!-- reviewed-source-files -->

Затронутые файлы реализации (каждый связан с действующим контрактом и регрессией в реестре):

- `packages/education-events/envelope.mjs`
- `packages/education-runtime/event-queue.mjs`
- `packages/education-runtime/legacy-event-reconciliation.mjs`
- `packages/education-runtime/upload-broker.mjs`
- `packages/telegram-notifications/adapters/config.mjs`
- `packages/telegram-notifications/adapters/runtime.mjs`
- `packages/telegram-notifications/adapters/worker-loop.mjs`
- `packages/telegram-notifications/application/education-event-routing.mjs`
- `packages/telegram-notifications/application/education-sync-dispatcher.mjs`
- `packages/telegram-notifications/operations/launch-agent.mjs`
- `packages/telegram-notifications/operations/private-logger.mjs`
- `scripts/direct-upload-worker.mjs`
- `scripts/education-events.mjs`
- `scripts/education-sync-dispatch.mjs`
- `scripts/install-upload-worker.mjs`
- `scripts/submissions.mjs`
- `scripts/telegram-bot.mjs`
- `scripts/telegram-indexes.mjs`
- `scripts/telegram-runtime.mjs`
- `src/lib/dayGuidance.ts`
- `src/lib/dayStore.ts`
- `src/lib/educationEventProducer.ts`
- `src/lib/familyBookUpload.ts`
- `src/lib/parentCompletion.ts`
- `src/lib/photoOutbox.ts`
- `src/lib/store.ts`
- `storage/family-book-projection.mjs`
- `storage/review-publication-event.mjs`
- `sync/event-task-artifact.mjs`
- `sync/event-task-export.mjs`
- `sync/legacy-help-identity.mjs`
- `firestore.rules`
- `scripts/firestore-rules-education-events.test.mjs`
- `scripts/education-events.test.mjs`
- `packages/education-runtime/event-queue.mjs`
- `packages/education-runtime/event-queue.test.mjs`
- `packages/telegram-notifications/application/education-event-routing.mjs`
