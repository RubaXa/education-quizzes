---
id: service.telegram-bot.event-ledger-outbox
status: accepted
implementation: partial
created: 2026-10-16
updated: 2026-10-18
consumers:
  - "Telegram service implementer"
  - "bot operator"
  - "parents and guardians"
code:
  - "packages/telegram-notifications/application/notifications.mjs"
  - "packages/telegram-notifications/adapters/firestore.mjs"
parent: service.telegram-bot
uses:
  - service.telegram-bot
  - service.telegram-bot.ports-and-events
sections:
  - задача
  - логические-записи
  - атомарность-и-идемпотентность
  - состояния
  - восстановление-и-retention
  - метрики-и-проверочные-сценарии
  - подмодули
---
# Журнал событий и delivery outbox

**Родитель:** [корневая архитектура](README.md); [порты и события](ports-and-events.md).
**Статус:** целевой контракт частично реализован.

Первый срез включает event/job transaction, idempotency по deterministic eventId, lease fencing token, expiry recovery, bounded retry states и durable per-part receipts. Источники работают в Mac runtime; семейные compact digests добавляют устойчивую группировку. Team routing и retention остаются незавершёнными.

## Задача

Развязать обнаружение изменения и Telegram API. Источник может повторить сигнал, Telegram — временно отказать, а worker — упасть между записью события и отправкой. Ledger/outbox обеспечивает устойчивость и контролируемое восстановление.

## Логические записи

- `telegramNotificationEvents/{eventId}`: schema version, source identity/revision, normalized domain event projection, detection time.
- `telegramNotificationOutbox/{jobId}`: event/recipient link identity and child scope, `state`, attempts, `nextAttemptAt`, lease owner/token/expiry, part receipts and safe error code.
- `checkpoints/{scopeKey}`: source adapter cursor или snapshot revision, completeness, last success time.
- `telegramNotificationGroups/{groupId}`: точная link/person/family/child/chat область, first/last accepted time, flush deadline, счётчик/бюджет, open/frozen/empty/dead_letter.
- `telegramNotificationGroupPointers/{groupingKey}`: указатель текущей открытой группы в этой области.

Эти коллекции — реализация текущего среза. Обычная legacy/probe job сохраняет неизменяемые `messageParts` и формат при enqueue; source job группы служит учётной связью события, а окончательные неизменяемые части digest фиксируются при freeze: `messageVersion: 1` — прежний массив текстовых строк, `messageVersion: 2` — строго валидированные structured parts [Telegram дизайна](../../shared/design/telegram.md). Старые pending jobs v1 остаются исполнимыми и не перерендериваются. Неизвестная/смешанная схема попадает в dead_letter. Индексы частей и receipts постоянны; Rich/HTML transport не создаёт вторую job и не меняет уже отправленные части. Автоматическая миграция неизвестных jobs не поддерживается. Перед delivery opt-in адресно объединить [индексы worker](../../../packages/telegram-notifications/firestore.indexes.json) с имеющимися индексами после проверки целевого проекта; автоматически заменять global Firebase index manifest этим scoped-файлом нельзя. Retention policy не утверждена.

## Атомарность и идемпотентность

Ответ `recordIfAbsent.queued` считает только реально новые jobs: verified target с уже существующим job ID не увеличивает счётчик. Проверка включает orphan job при отсутствующем event document. Существующая job не перезаписывается; повтор event по-прежнему возвращает existing receipt без позднего backfill.


1. Детерминированный `eventId` вычисляется до записи.
2. Транзакция создаёт event только если его нет и добавляет уникальные delivery jobs/групповые references для соответствующих получателей.
3. Повторная обработка получает receipt существующего event и не создаёт повторную доставку.
4. Worker захватывает job атомарной lease с непредсказуемым fencing token; только тот же worker с тем же token и непросроченной lease может продлить её, записать receipt или завершить/перенести job.
5. После отправки сохраняется receipt. Падение между фактическим `sendMessage` и записью receipt может привести к повторной отправке: Telegram send API не является транзакцией с Firestore. Повтор минимизируется и маркируется, но exactly-once обещать нельзя.

Для семейного дайджеста ключ изолирует chat + family + person + link + child; при отзыве/перепривязке получатели не смешиваются. Приём события атомарно создаёт ledger и source job, добавляет её в открытую группу либо создаёт следующую. Время окна берётся из приёма worker, а не старого detectedAt восстановленного события. Quiet deadline30с ограничен60с от первого приёма; nextAttemptAt всех ещё открытых source jobs переносится в той же транзакции. Неготовые группы не занимают первые20due jobs.

При наступлении срока claim транзакционно замораживает группу: создаёт один неизменяемый digest job, сохраняет eventIds/eventJobIds и переводит исходные jobs в `grouped` с `groupedInto`. Новое событие после заморозки идёт в следующую группу; старые части не перерендериваются. Дайджест проходит прежний delivery lifecycle, проверку membership/channel перед каждой частью и receipts. Перезапуск находит due source jobs или уже замороженный pending/retry digest. Диагностика исходного события следует по groupedInto и проверяет обратную связь eventJobIds.

Одна группа ограничена50событиями/256KiB подготовленных данных; превышение открывает следующую группу без потери событий и без ограничения числа семей. Длинная сводка разделяется по строкам на Telegram-safe части с сохранением порядка. Старые v1/v2 jobs и technical.probe не объединяются повторно: их сохранённые части остаются неизменными. Ограничения группы защищают Firestore transaction/document budgets, а не устанавливают allowlist пользователей.

## Состояния

`pending → leased → sent`

Ветви ошибок: `leased → retry_wait → pending`; исчерпание/неисправимая ошибка → `dead_letter` с операторской видимостью. Просроченная lease возвращается в очередь. Ошибка источника не создаёт delivery job, пока событие не подтверждено; подтверждённые события сохраняются при любой недоступности Telegram.

Retry policy ограничивает число попыток, включая каждое lease claim: повторный crash также расходует попытку; recovery ставит bounded delay. Политика использует exponential delays и отдельную обработку 429 `retry_after`, 5xx/network, blocked user и malformed request.

## Восстановление и retention

- На старте worker находит просроченные leases, готовые retries и открытые группы с истёкшим flush deadline.
- Reconnect источника запускает reconciliation от последнего подтверждённого checkpoint.
- Для МЭШ после пропуска нескольких poll интервалов отправляется только подтверждённая разница между полными snapshots; историю, которой источник больше не предоставляет, нельзя реконструировать.
- Для Firebase повторно читаются актуальные документы и их revision.
- Удаление/архив ledger и персональных ссылок регулируется установленным retention period; срок пока открыт. Сырые документы источника хранить в outbox нельзя.

## Метрики и проверочные сценарии

Считать pending age, retries, dead-letter count, expired leases, duplicate suppression, event-to-send latency и recovery backlog без содержимого оценок/работ. Проверить падение на каждой границе записи/отправки, гонку двух worker, повторный сигнал, истечение lease, 429, permanent blocked recipient, длинный outage и восстановление группировки.

## Подмодули

При необходимости отдельно описать `storage-schema.md`, `retry-policy.md` и `recovery.md`; пока все три следуют единому outbox lifecycle и остаются здесь.
