---
id: service.telegram-bot.event-ledger-outbox
status: accepted
implementation: planned
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
**Статус:** целевой контракт, не реализован.

## Задача

Развязать обнаружение изменения и Telegram API. Источник может повторить сигнал, Telegram — временно отказать, а worker — упасть между записью события и отправкой. Ledger/outbox обеспечивает устойчивость и контролируемое восстановление.

## Логические записи

- `events/{eventId}`: schema version, source identity/revision, domain event projection, detection time, processing state, audit refs.
- `outbox/{jobId}`: `eventId`, recipient key, channel, message grouping key, delivery state, attempts, `nextAttemptAt`, lease owner/expiry, safe error code, sent message IDs.
- `checkpoints/{scopeKey}`: source adapter cursor или snapshot revision, completeness, last success time.
- `groups/{groupKey}`: recipient, event references, first event time, last event time, flush deadline, status.

Имена коллекций ориентировочные. До фиксации схемы проверить лимиты размеров, Firestore transaction/batch semantics, индексы и retention.

## Атомарность и идемпотентность

1. Детерминированный `eventId` вычисляется до записи.
2. Транзакция создаёт event только если его нет и добавляет уникальные delivery jobs/групповые references для соответствующих получателей.
3. Повторная обработка получает receipt существующего event и не создаёт повторную доставку.
4. Worker захватывает job атомарной lease; только владелец непросроченной lease может завершить/перенести job.
5. После отправки сохраняется receipt. Падение между фактическим `sendMessage` и записью receipt может привести к повторной отправке: Telegram send API не является транзакцией с Firestore. Повтор минимизируется и маркируется, но exactly-once обещать нельзя.

Для группового дайджеста стабильный `groupKey` вычисляется по recipient + окну/периоду; добавление событий не создаёт параллельный дайджест той же группы. Очередь должна ограничивать конкурентные отправки на chat и соблюдать Telegram rate limits.

## Состояния

`pending → leased → sent`

Ветви ошибок: `leased → retry_wait → pending`; исчерпание/неисправимая ошибка → `dead_letter` с операторской видимостью. Просроченная lease возвращается в очередь. Ошибка источника не создаёт delivery job, пока событие не подтверждено; подтверждённые события сохраняются при любой недоступности Telegram.

Retry policy должна иметь ограниченные exponential delays, jitter, максимум попыток/возраста и отдельную обработку 429 `retry_after`, 5xx/network, blocked user и malformed request. Окончательные значения настраиваются в operations spec.

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
