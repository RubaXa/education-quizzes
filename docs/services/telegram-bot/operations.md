---
id: service.telegram-bot.operations
status: accepted
implementation: partial
created: 2026-10-16
updated: 2026-10-17
consumers:
  - "Telegram service implementer"
  - "bot operator"
  - "parents and guardians"
code:
  - "packages/telegram-notifications/adapters/config.mjs"
  - "packages/telegram-notifications/adapters/runtime.mjs"
  - "packages/telegram-notifications/adapters/telegram.mjs"
  - "scripts/telegram-bot.mjs"
  - packages/telegram-notifications/adapters/worker-loop.mjs
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

Целевой runtime — один постоянно работающий Node.js worker с long polling Telegram, Firestore listeners и периодическим МЭШ poll. Source listeners/polling подключаются отдельными флагами; delivery выключена по умолчанию. Семьи, дети и источники обнаруживаются автоматически из Education registry, без allowlist и продуктового ограничения их количества. Host/deployment не выбран; Firebase Functions — отдельная альтернатива с иным scheduler/webhook контрактом, а не переключение одной переменной.

Runtime composition root загружает/валидирует config, создаёт registry/ledger/Telegram adapters и application services. Core modules не читают process.env. Первоначальный inventory запускается параллельно Telegram polling и outbox: рост числа семей или медленный источник не задерживает приём команд и доставку уже поставленных jobs. Ошибка одного source/child discovery не блокирует здоровые источники/детей той же семьи; failed context сохраняет прежний подтверждённый graph и даёт health signal. SIGINT/SIGTERM interrupt idle wait, останавливают bot, в пределах общего 25-секундного shutdown budget ждут polling promise (включая завершение in-flight handlers), закрытие inventory/listeners/pollers и текущий delivery drain, затем вызывают Firestore `terminate()`. Ошибка drain/stop/terminate логируется безопасным кодом и выставляет failure exit status; при превышении deadline worker завершает процесс с failure code. Hosted deployment и readiness не настроены.

## Конфигурация

Минимальные группы параметров:

- Telegram bot token и разрешённые team recipient IDs.
- `TELEGRAM_FIRESTORE_PROJECT_ID`, ADC и `TELEGRAM_WORKER_ID`.
- Автоматическое обнаружение Education registry, технические размеры страниц, период reconciliation и concurrency.
- Окна группировки, poll interval, retry bounds, lease duration, concurrency limits.
- Environment/instance ID, log level, privacy-safe diagnostics.

Секрет Telegram читается только из `AGI_EDU_BOT`; `check` выполняет `getMe`, проверяет username `agi_edu_bot` и не создаёт Firestore client. Явный `worker` требует `TELEGRAM_FIRESTORE_PROJECT_ID`, разрешает ADC чтением `telegramBotRuntimeChecks/{projectId}` до polling и использует default application credentials. `--enable-delivery` отдельно включает чтение outbox; без него доставка выключена. Секреты передавать через host secret manager или ADC; никакого `.env`, credentials JSON или token в Git/логах. Ошибки логируются только из finite safe-code set.

Для ledger/outbox нужен scoped manifest [firestore.indexes.json](../../../packages/telegram-notifications/firestore.indexes.json). До delivery opt-in проверить существующие индексы проекта и объединить адресно два composite index (`state + nextAttemptAt`, `state + leaseUntil`); manifest сам по себе не выпущен и не должен автоматически заменять глобальный Firebase index manifest.

### Подключение источников

```bash
npm run telegram:worker -- --enable-firestore-source
npm run telegram:worker -- --enable-firestore-source --enable-mesh-source
npm run telegram:worker -- --enable-firestore-source --enable-mesh-source --enable-delivery
```

Первые две команды — shadow: они читают источники и пишут только checkpoints/discovery. `--enable-delivery` включает notify namespace и outbox. Первое наблюдение существующей области тихое; notify и shadow имеют независимые baseline. Новые записи уже наблюдаемой семьи учитываются после bootstrap. Новая семья/ребёнок сначала получает тихий baseline, без исторической рассылки. Источник подключается при следующем reconciliation без изменения конфигурации и перезапуска.

МЭШ использует адресные локальные credentials `.local/mesh-connections/{sourceAccountId}.json` действующего Education connection flow. Отсутствие файла/ошибка связи блокирует только этот источник и отражается безопасным health code; общая legacy `.local/diary` не подставляется. Внутри процесса запросы/refresh одной родительской учётной записи сериализованы, каждый ребёнок получает отдельный adapter. Межпроцессной аренды общей credential session пока нет: запускать одного владельца МЭШ credentials. Checkpoint leases защищают scope/event sequence, но не заменяют эту аренду.

Технические параметры описаны в config adapter: страницы inventory, bounded concurrency, reconciliation interval и poll interval. Pagination проходит все страницы; очередь продолжает обработку остальных семей после ошибки одной. Горизонт расписания/ДЗ автоматически движется по `dateWindow`: текущая неделя и ещё пять, с отдельными дневными scope. Это горизонт учебных данных, а не ограничение количества семей. Оценки делятся по подтверждённым source period/subject IDs, полученным из полного getMarks; прошлые периоды не накапливаются в одном checkpoint. Новая календарная/периодная область МЭШ всегда начинает с тихого baseline: сам вход даты в горизонт не доказывает создание урока или ДЗ. При нескольких взрослых source accounts выбирается один источник ребёнка, чтобы не дублировать сообщения. Реальные API limits и расходы требуют эксплуатационного замера.

## IAM и данные

Checkpoints хранятся в `telegramNotificationSourceCheckpoints`, обнаружение — в `telegramSourceDiscovery`; записи namespace-separated, scope/reference IDs хэшированы. Служебные state/baseline/pending не содержат исходные credentials, ответы тестов, оригиналы или URL. Firestore document listeners могут получить полный SDK snapshot; обработчик использует его только как сигнал и перечитывает разрешённые поля, raw payload не сохраняет и не логирует.

Отдельная workload identity с минимальными правами на согласованные source paths и служебные registry/ledger/outbox. Серверный SDK обходит Security Rules; правила клиента не ограничивают worker. Не выдавать project-wide Owner/Editor. Отделить read-only доступ к учебным источникам от ограниченного write доступа к служебным коллекциям настолько, насколько позволяет IAM/структура проекта.

## Здоровье и сигналы

В структурированные logs/metrics включать instance, module, scope hash, eventId, duration, retry/error class и backlog. Не включать имена детей в метрики, raw payload, Telegram token/chat body, credentials или закрытые ответы.

Readiness учитывает Telegram authorization, Firestore connectivity, активность обязательных source adapters и просрочку успешного poll. Ошибка одной семьи/учётной записи адресуется её scope и не маскируется общим зелёным статусом. Текущий runtime пишет безопасные структурированные health codes. Hosted readiness endpoint, доставка командных alerts и recovery digest остаются целевыми требованиями, а не выпущенными функциями.

## Развёртывание и rollout

1. Локальный dry-run на фиксированных безопасных fixtures.
2. Source shadow mode: сохранять безопасные baseline/checkpoints без вызова accept, создания outbox и Telegram send.
3. Сравнить выборку events с источником и проверить утечки/дедупликацию.
4. Проверить права всех автоматически обнаруженных семей и подтверждённые Telegram links; включить delivery отдельным флагом.
5. Наблюдать latency, backlog и dead-letter при общем динамическом охвате. Ручные списки семей и детей не используются.

Rollback выключает source processing и сохраняет ledger/outbox для дальнейшего разбора. Не удалять очередь/registry при rollback. Перед первой эксплуатацией определить retention, алертинг и владельца ручной обработки dead letters.

## Подмодули

После выбора host вынести `deployment/<host>.md`; если появятся on-call процедуры — `runbooks/<incident>.md`. Не описывать невыбранный хост как действующий.
