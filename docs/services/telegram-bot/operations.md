---
id: service.telegram-bot.operations
status: accepted
implementation: partial
created: 2026-10-16
updated: 2026-10-16
consumers:
  - "Telegram service implementer"
  - "bot operator"
  - "parents and guardians"
code:
  - "packages/telegram-notifications/adapters/config.mjs"
  - "packages/telegram-notifications/adapters/runtime.mjs"
  - "packages/telegram-notifications/adapters/telegram.mjs"
  - "scripts/telegram-bot.mjs"
parent: service.telegram-bot
uses:
  - service.telegram-bot
sections:
  - runtime-boundary
  - конфигурация
  - iam-и-данные
  - здоровье-и-сигналы
  - развёртывание-и-rollout
  - подмодули
---
# Runtime и эксплуатация Telegram notification service

**Родитель:** [корневая архитектура](README.md).
**Статус:** local check/worker entrypoints exist; hosted deployment, alerting and production rollout are not configured.

## Runtime boundary

Целевой runtime — один постоянно работающий Node.js worker с long polling Telegram, Firestore listeners и периодическим МЭШ poll. В текущем срезе source listeners/polling отсутствуют: worker может обрабатывать только уже записанные jobs, а delivery выключена по умолчанию. Host/deployment не выбран; Firebase Functions — отдельная альтернатива с иным scheduler/webhook контрактом, а не переключение одной переменной.

Runtime composition root загружает/валидирует config, создаёт registry/ledger/Telegram adapters и application services. Core modules не читают process.env. SIGINT/SIGTERM interrupt idle wait, останавливают bot, в пределах общего 25-секундного shutdown budget ждут polling promise (включая завершение in-flight handlers) и текущий delivery drain, затем вызывают Firestore `terminate()`. Ошибка drain/stop/terminate логируется безопасным кодом и выставляет failure exit status; при превышении deadline worker завершает процесс с failure code. Hosted deployment и readiness не настроены.

## Конфигурация

Минимальные группы параметров:

- Telegram bot token и разрешённые team recipient IDs.
- `TELEGRAM_FIRESTORE_PROJECT_ID`, ADC и `TELEGRAM_WORKER_ID`.
- Firestore source path registry (observers are not implemented in this increment).
- Окна группировки, poll interval, retry bounds, lease duration, concurrency limits.
- Environment/instance ID, log level, privacy-safe diagnostics.

Секрет Telegram читается только из `AGI_EDU_BOT`; `check` выполняет `getMe`, проверяет username `agi_edu_bot` и не создаёт Firestore client. Явный `worker` требует `TELEGRAM_FIRESTORE_PROJECT_ID`, разрешает ADC чтением `telegramBotRuntimeChecks/{projectId}` до polling и использует default application credentials. `--enable-delivery` отдельно включает чтение outbox; без него доставка выключена. Секреты передавать через host secret manager или ADC; никакого `.env`, credentials JSON или token в Git/логах. Ошибки логируются только из finite safe-code set.

Для ledger/outbox нужен scoped manifest [firestore.indexes.json](../../../packages/telegram-notifications/firestore.indexes.json). До delivery opt-in проверить существующие индексы проекта и объединить адресно два composite index (`state + nextAttemptAt`, `state + leaseUntil`); manifest сам по себе не выпущен и не должен автоматически заменять глобальный Firebase index manifest.

## IAM и данные

Отдельная workload identity с минимальными правами на согласованные source paths и служебные registry/ledger/outbox. Серверный SDK обходит Security Rules; правила клиента не ограничивают worker. Не выдавать project-wide Owner/Editor. Отделить read-only доступ к учебным источникам от ограниченного write доступа к служебным коллекциям настолько, насколько позволяет IAM/структура проекта.

## Здоровье и сигналы

В структурированные logs/metrics включать instance, module, scope hash, eventId, duration, retry/error class и backlog. Не включать имена детей в метрики, raw payload, Telegram token/chat body, credentials или закрытые ответы.

Readiness учитывает Telegram authorization, Firestore connectivity, активность обязательных source adapters и просрочку успешного poll. Ошибка одной семьи/учётной записи адресуется её scope и не маскируется общим зелёным статусом. Команда получает структурированный сигнал о source outage и recovery digest согласно бизнес-контракту.

## Развёртывание и rollout

1. Локальный dry-run на фиксированных безопасных fixtures.
2. Source shadow mode: записывать ожидаемые DomainEvents без Telegram send.
3. Сравнить выборку events с источником и проверить утечки/дедупликацию.
4. Включить allowlist семей и тестовый получатель.
5. Включить общий охват, наблюдая latency, backlog и dead-letter.

Rollback выключает source processing и сохраняет ledger/outbox для дальнейшего разбора. Не удалять очередь/registry при rollback. Перед первой эксплуатацией определить retention, алертинг и владельца ручной обработки dead letters.

## Подмодули

После выбора host вынести `deployment/<host>.md`; если появятся on-call процедуры — `runbooks/<incident>.md`. Не описывать невыбранный хост как действующий.
