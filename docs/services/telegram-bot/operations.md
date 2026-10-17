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
  - scripts/telegram-runtime.mjs
  - scripts/telegram-indexes.mjs
  - packages/telegram-notifications/operations/launch-agent.mjs
  - packages/telegram-notifications/operations/process-lock.mjs
  - packages/telegram-notifications/operations/readiness.mjs
  - packages/telegram-notifications/operations/source-check.mjs
  - packages/telegram-notifications/operations/probe-runner.mjs
  - packages/telegram-notifications/operations/probe-target.mjs
  - packages/telegram-notifications/operations/private-logger.mjs
parent: service.telegram-bot
uses:
  - service.telegram-bot
  - shared.server-runtime
sections:
  - runtime-boundary
  - конфигурация
  - index-readiness
  - iam-и-данные
  - здоровье-и-сигналы
  - развёртывание-и-rollout
  - подмодули
---
# Runtime и эксплуатация Telegram notification service

**Родитель:** [корневая архитектура](README.md).
**Статус:** worker, readiness/source-check/probe и macOS LaunchAgent tooling реализованы. 17.10 на согласованном Mac установлен releasef87008027b4453cf68b56e8a; оба outbox index READY, реальные технические probes sent/receipt1 и readiness running/readyForDelivery подтверждены. [Факты и ограничения](../../audits/server-core-review-2026-10-17.md#результаты-проверки). Внешние alerts не настроены.

## Runtime boundary

Целевой runtime — один постоянно работающий Node.js worker с long polling Telegram, Firestore listeners и периодическим МЭШ poll. Source listeners/polling подключаются отдельными флагами; delivery выключена по умолчанию. Семьи, дети и источники обнаруживаются автоматически из Education registry, без allowlist и продуктового ограничения их количества. Локальный постоянный host — macOS LaunchAgent; Firebase Functions — отдельная альтернатива с иным scheduler/webhook контрактом, а не переключение одной переменной.

Runtime composition root загружает/валидирует config, создаёт registry/ledger/Telegram adapters и application services. Core modules не читают process.env. Первоначальный inventory запускается параллельно Telegram polling и outbox: рост числа семей или медленный источник не задерживает приём команд и доставку уже поставленных jobs. Ошибка одного source/child discovery не блокирует здоровые источники/детей той же семьи; failed context сохраняет прежний подтверждённый graph и даёт health signal. SIGINT/SIGTERM interrupt idle wait, останавливают bot, в пределах25-секундного drain budget ждут polling promise (включая завершение in-flight handlers), закрытие inventory/listeners/pollers и текущий delivery drain, затем вызывают Firestore `terminate()` с отдельным5-секундным cleanup budget. LaunchAgent ExitTimeOut35с покрывает оба этапа; spans `telegram.shutdown.*` показывают фактического ожидающего. Ошибка drain/stop/terminate логируется безопасным кодом и выставляет failure exit status; при превышении deadline worker завершает процесс с failure code. Readiness доступна через CLI; hosted endpoint отсутствует.

Discovery подтверждает scope origins не более чем8 транзакциями одновременно; context completion записывается только после всех scopes. Reconcile single-flight. Отмена при close останавливает новые страницы, read batches и транзакции; уже начатые SDK операции дожидаются в пределах shutdown budget. Mesh HTTP/retry wait и ожидание account lock принимают сигнал отмены; поздний refresh после отмены не сохраняется. При отмене ни event accept, ни baseline advance не выполняются; durable pending/origins доступны для resume.

## Конфигурация

Минимальные группы параметров:

- Telegram bot token и подтверждённые family links; team routing остаётся целевым.
- `TELEGRAM_FIRESTORE_PROJECT_ID`, ADC и `TELEGRAM_WORKER_ID`.
- Автоматическое обнаружение Education registry, технические размеры страниц, период reconciliation и concurrency.
- Окна группировки, poll interval, retry bounds, lease duration, concurrency limits.
- Environment/instance ID, log level, privacy-safe diagnostics.

Секрет Telegram читается из `AGI_EDU_BOT` либо закрытого `TELEGRAM_TOKEN_FILE` с проверкой прав/владельца; `check` выполняет `getMe`, проверяет username `agi_edu_bot` и не создаёт Firestore client. Явный `worker` требует `TELEGRAM_FIRESTORE_PROJECT_ID`, разрешает ADC чтением `telegramBotRuntimeChecks/{projectId}` до polling и использует default application credentials. `--enable-delivery` отдельно включает чтение outbox; без него доставка выключена. Секреты передавать через host secret manager или ADC; никакого `.env`, credentials JSON или token в Git/логах. Ошибки логируются только из finite safe-code set.

Для ledger/outbox используется scoped manifest [firestore.indexes.json](../../../packages/telegram-notifications/firestore.indexes.json). Общий `firebase.json`/global index manifest этим инструментом не заменяется.

## Index readiness

Перед включением delivery явно выбери Firestore project и проверь текущее состояние scoped indexes:

```bash
npm run telegram:indexes -- list --project PROJECT_ID
npm run telegram:indexes -- plan --project PROJECT_ID
npm run telegram:indexes -- plan --project PROJECT_ID --apply
```

Вместо `--project` можно задать `TELEGRAM_FIRESTORE_PROJECT_ID`; проект не выводится из другого Firebase default. `list` показывает два составных индекса для `telegramNotificationOutbox` из Telegram manifest и их `READY`/`CREATING`/`MISSING` состояние. `plan` ничего не меняет, перечисляет отсутствующие точные составные индексы. Только `plan --apply` создаёт недостающие записи через Firestore Admin v1, используя общий локальный/ambient ADC resolver. Он не удаляет индексы, не обновляет индексы с другой формой и не заменяет project-wide manifest. После запроса команда опрашивает точное состояние не дольше 90 секунд; если index ещё не `READY`, печатает безопасный статус и завершается с ненулевым кодом. Создание требует права изменения indexes на выбранном проекте.

### Подключение источников

```bash
npm run telegram:worker -- --enable-firestore-source
npm run telegram:worker -- --enable-firestore-source --enable-mesh-source
npm run telegram:worker -- --enable-firestore-source --enable-mesh-source --enable-delivery
```

Первые две команды — shadow: они читают источники и пишут только checkpoints/discovery. `--enable-delivery` включает notify namespace и outbox. Первое наблюдение существующей области тихое; notify и shadow имеют независимые baseline. Новые записи уже наблюдаемой семьи учитываются после bootstrap. Новая семья/ребёнок сначала получает тихий baseline, без исторической рассылки. Источник подключается при следующем reconciliation без изменения конфигурации и перезапуска.

МЭШ использует общий [MeshSession/credential store](../../shared/server-runtime.md#авторизация-и-совместимость) с education-sync. Канонические credentials лежат в `.local/mesh-connections/{sourceAccountId}.json`; точный legacy owner разрешён общим codec. Ошибки не подменяются credentials другой семьи. Каждый ребёнок получает отдельный adapter, refresh сохраняет только tokens атомарно0600. Sync и worker сериализуют один account kernel lock Python3/fcntl на одном хосте; общие physical paths обязательны, независимую копию vault для daemon создавать нельзя.

Технические параметры описаны в config adapter: страницы inventory, bounded concurrency, reconciliation interval и poll interval. Pagination проходит все страницы; очередь продолжает обработку остальных семей после ошибки одной. Горизонт расписания/ДЗ автоматически движется по `dateWindow`: текущая неделя и ещё пять, с отдельными дневными scope. Это горизонт учебных данных, а не ограничение количества семей. Оценки делятся по подтверждённым source period/subject IDs, полученным из полного getMarks; прошлые периоды не накапливаются в одном checkpoint. Новая календарная/периодная область МЭШ всегда начинает с тихого baseline: сам вход даты в горизонт не доказывает создание урока или ДЗ. При нескольких взрослых source accounts выбирается один источник ребёнка, чтобы не дублировать сообщения. Реальные API limits и расходы требуют эксплуатационного замера.

## IAM и данные

Checkpoints хранятся в `telegramNotificationSourceCheckpoints`, обнаружение — в `telegramSourceDiscovery`; записи namespace-separated, scope/reference IDs хэшированы. Служебные state/baseline/pending не содержат исходные credentials, ответы тестов, оригиналы или URL. Firestore document listeners могут получить полный SDK snapshot; обработчик использует его только как сигнал и перечитывает разрешённые поля, raw payload не сохраняет и не логирует.

Отдельная workload identity с минимальными правами на согласованные source paths и служебные registry/ledger/outbox. Серверный SDK обходит Security Rules; правила клиента не ограничивают worker. Не выдавать project-wide Owner/Editor. Отделить read-only доступ к учебным источникам от ограниченного write доступа к служебным коллекциям настолько, насколько позволяет IAM/структура проекта.

## Здоровье и сигналы

В структурированные logs/metrics включать instance, module, scope hash, eventId, duration, retry/error class и backlog. Не включать имена детей в метрики, raw payload, Telegram token/chat body, credentials или закрытые ответы.

Readiness учитывает текущую Telegram family authorization, Firestore connectivity, два outbox query preflight, локальные credentials и фактический loaded/running LaunchAgent. Охват МЭШ проверяет отдельный source-check; freshness последнего успешного poll в readiness пока не проверяется. linkIssuerAvailable означает наличие локального CLI в этой версии, а не наблюдаемое здоровье web issuer. Ошибка одной семьи/учётной записи адресуется её scope и не маскируется общим зелёным статусом. Текущий runtime пишет безопасные структурированные health codes и [общую telemetry](../../shared/server-runtime.md#телеметрия): trace/span, длительности SDK/HTTP/lock/cache, retries и счётчики. JSONL0600 ротируется; raw payload/token/имена не экспортируются. Потери exporter/buffer считаются явно. SDK-read counters не равны billed reads. Hosted readiness endpoint, доставка командных alerts и recovery digest остаются целевыми требованиями, а не выпущенными функциями.

## Развёртывание и rollout

1. Локальный dry-run на фиксированных безопасных fixtures.
2. Source shadow mode: сохранять безопасные baseline/checkpoints без вызова accept, создания outbox и Telegram send.
3. Сравнить выборку events с источником и проверить утечки/дедупликацию.
4. Проверить права всех автоматически обнаруженных семей и подтверждённые Telegram links; включить delivery отдельным флагом.
5. Наблюдать latency, backlog и dead-letter при общем динамическом охвате. Ручные списки семей и детей не используются.

Rollback выключает source processing и сохраняет ledger/outbox для дальнейшего разбора. Не удалять очередь/registry при rollback. Перед первой эксплуатацией определить retention, алертинг и владельца ручной обработки dead letters.

### Штатные команды

```bash
npm run telegram:runtime -- readiness
npm run telegram:runtime -- source-check
npm run telegram:runtime -- probe --source firestore --target-digest TARGET_HASH
npm run telegram:runtime -- probe --source mesh --target-digest TARGET_HASH --apply
npm run telegram:install-worker
npm run telegram:install-worker -- --apply
npm run telegram:status
npm run telegram:stop
npm run telegram:runtime -- uninstall --apply
```

`source-check` читает динамический graph и реальные МЭШ observations всех доступных подключений без SourcePipeline/academic/outbox writes или отправок; refresh может обновить локальные tokens. Неполный охват обязан быть видимым. Probe dry-run не пишет; apply использует явное `technical.probe`, точную подтверждённую link по opaque digest, отдельный служебный Firestore документ либо реальное чтение МЭШ, затем общий pipeline/ledger/outbox/transport. Exact job claim не дренирует постороннюю очередь; успешность требует readback `sent` и receipt. Это проверка технической цепочки, не естественного изменения оценки.

Installer сначала возвращает план. Apply создаёт content-addressed runtime release в закрытом Application Support, production dependencies и secret file0600. Plist содержит пути, абсолютный Node и только несекретную конфигурацию. Общие ADC/Mesh vault остаются по тем же путям, что у sync. Singleton kernel lock запрещает второй poller; потеря broker приводит к остановке. LaunchAgent RunAtLoad/KeepAlive перезапускает аварийный процесс с throttle; SIGTERM выполняет общий shutdown. Журналы и telemetry ротируются. Stop/uninstall сохраняют release, секрет и Firestore ledger/outbox для обратимого восстановления. Повторная install предыдущей версии — rollback к её content hash.

Mac должен быть включён, доступен и находиться в пользовательском сеансе; сон/выключение не обеспечивают24/7. При ограничениях macOS TCC доступ к общему vault проверяется фактическим запуском; копировать секреты в расходящиеся vault запрещено. Для непрерывной доступности на другом host требуется отдельная установка с общей политикой владения и распределённой session lease.

## Подмодули

Общие IO/session/telemetry принадлежат серверному ядру. Отдельный host runbook выносится при появлении второго deployment; новые on-call контракты создаются по реальной потребности.
