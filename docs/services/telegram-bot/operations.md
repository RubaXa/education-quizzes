---
id: service.telegram-bot.operations
status: accepted
implementation: partial
created: 2026-10-16
updated: 2026-10-19
consumers:
  - "Telegram service implementer"
  - "bot operator"
  - "parents and guardians"
code:
  - scripts/telegram-design-preview.mjs
  - "packages/telegram-notifications/adapters/config.mjs"
  - "packages/telegram-notifications/adapters/runtime.mjs"
  - "packages/telegram-notifications/adapters/telegram.mjs"
  - "scripts/telegram-bot.mjs"
  - packages/telegram-notifications/adapters/worker-loop.mjs
  - scripts/telegram-runtime.mjs
  - packages/telegram-notifications/operations/mesh-delivery-check.mjs
  - packages/telegram-notifications/operations/operation-deadline.mjs
  - scripts/telegram-indexes.mjs
  - packages/telegram-notifications/operations/launch-agent.mjs
  - packages/telegram-notifications/operations/process-lock.mjs
  - packages/telegram-notifications/operations/readiness.mjs
  - packages/telegram-notifications/operations/source-check.mjs
  - packages/telegram-notifications/operations/upload-check.mjs
  - packages/telegram-notifications/operations/probe-runner.mjs
  - packages/telegram-notifications/operations/probe-target.mjs
  - packages/telegram-notifications/operations/private-logger.mjs
parent: service.telegram-bot
uses:
  - service.telegram-bot
  - service.telegram-bot.education-sync-dispatch
  - shared.server-runtime
sections:
  - runtime-boundary
  - конфигурация
  - index-readiness
  - iam-и-данные
  - здоровье-и-сигналы
  - развёртывание-и-rollout
  - подмодули
  - восстановление-зависших-операций
  - проверка-реальных-изменений-мэш
  - education-sync-dispatch
---
# Runtime и эксплуатация Telegram notification service

**Родитель:** [корневая архитектура](README.md).
**Статус:** worker, readiness/source-check/probe и macOS LaunchAgent tooling реализованы. Исторические live receipts подтверждают предыдущую Mesh/upload архитектуру. Unified `educationEvents` runtime подключён в checkout; постоянный release, producer/rules/index coverage и полная client migration ещё не подтверждены. Queue readiness поэтому не считается доказательством полной migration. Внешние alerts не настроены.

## Runtime boundary

После durable приёма события source handler передаёт локальному consumer время готовности из ledger/dispatcher. Idle ожидание прерывается к этому сроку; транзакционный claim сохраняет quiet/debounce/retry ограничения. Сигнал во время активного запроса не теряется, истёкший hint потребляется однократно. При остановке таймеры и callbacks отключаются. Для рестарта и внешних записей остаётся fallback с базой до60с и jitter до20% (до72с плюс время запроса/планировщика), без постоянного частого polling. Семантика сроков описана в [outbox](event-ledger-outbox.md) и [dispatcher](education-sync-dispatch.md).

Runtime — один Node.js worker с Telegram long polling, одной Firestore subscription на `educationEvents` при включённой delivery и периодическим Mesh HTTP poll. Bounded compatibility reconcilers покрывают старые PWA uploads/help/quiz actions без source listeners. Firestore handlers читают точный source по event `sourceRef`; dynamic discovery listeners не запускаются. Delivery выключена по умолчанию. Локальный постоянный host — macOS LaunchAgent; Firebase Functions — отдельная альтернатива с иным scheduler/webhook контрактом, а не переключение одной переменной.

Runtime composition root validates configuration and creates identity, ledger, Telegram adapters and typed event handlers. Core modules do not read process.env. The event consumer waits for its initial subscription acknowledgement, then uses fenced event claims and durable phase checkpoints. New Firestore actions do not use source coordinators or discovery listeners; exact-source reads remain inside queue handlers. Mesh keeps its own bounded HTTP poll and source checkpoint. Shutdown stops Telegram polling, the queue consumer, reconcilers and active delivery within the drain budget, then terminates Firestore. Queue-listening readiness confirms only the subscription, not producer coverage or delivery.

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

Вместо `--project` можно задать `TELEGRAM_FIRESTORE_PROJECT_ID`; проект не выводится из другого Firebase default. `list` показывает все явно заданные составные индексы outbox/event queue/frozen action range и single-field group indexes переходной сверки из manifest, а также их `READY`/`CREATING`/`MISSING` состояние. `plan` ничего не меняет, перечисляет отсутствующие точные составные индексы. Только `plan --apply` создаёт недостающие записи через Firestore Admin v1, используя общий локальный/ambient ADC resolver. Для single-field `COLLECTION_GROUP` он добавляет нужную конфигурацию поля, сохраняя существующие field indexes. Контракт API: [Field patch](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.fields/patch). Он не удаляет индексы, не обновляет индексы с другой формой и не заменяет project-wide manifest. После запроса команда опрашивает точное состояние не дольше 90 секунд; если index ещё не `READY`, печатает безопасный статус и завершается с ненулевым кодом. Создание требует права изменения indexes на выбранном проекте.

### Подключение источников

```bash
npm run telegram:worker -- --enable-firestore-source
npm run telegram:worker -- --enable-mesh-source
npm run telegram:worker -- --enable-mesh-source --enable-delivery
```

`--enable-firestore-source` enables targeted Firestore projection reads for supported queue events; it does not install listeners or scan an inventory. `--enable-mesh-source` runs the Mesh HTTP poller and writes normalized events to the shared queue. `--enable-delivery` starts the queue consumer, temporary old-client reconciliation, NotificationService outbox and EducationSync dispatcher. Only this shared consumer claims and acknowledges queue events.

МЭШ использует общий [MeshSession/credential store](../../shared/server-runtime.md#авторизация-и-совместимость) с education-sync. Канонические credentials лежат в `.local/mesh-connections/{sourceAccountId}.json`; точный legacy owner разрешён общим codec. Ошибки не подменяются credentials другой семьи. Каждый ребёнок получает отдельный adapter, refresh сохраняет только tokens атомарно0600. Sync и worker сериализуют один account kernel lock Python3/fcntl на одном хосте; общие physical paths обязательны, независимую копию vault для daemon создавать нельзя.

Технические параметры описаны в config adapter: страницы inventory, bounded concurrency, reconciliation interval и poll interval. Pagination проходит все страницы; очередь продолжает обработку остальных семей после ошибки одной. Горизонт расписания/ДЗ автоматически движется по `dateWindow`: текущая неделя и ещё пять, с отдельными дневными scope. Это горизонт учебных данных, а не ограничение количества семей. Оценки делятся по подтверждённым source period/subject IDs, полученным из полного getMarks; прошлые периоды не накапливаются в одном checkpoint. Новая календарная/периодная область МЭШ всегда начинает с тихого baseline: сам вход даты в горизонт не доказывает создание урока или ДЗ. При нескольких взрослых source accounts выбирается один источник ребёнка, чтобы не дублировать сообщения. Реальные API limits и расходы требуют эксплуатационного замера.

## IAM и данные

Queue event state хранится в `educationEvents`; Mesh source checkpoints and temporary legacy action cursors remain separate. События содержат stable identity, typed `sourceRef` и ограниченный normalized payload. Исходные ответы, файлы, URL и credentials исключены; handler перечитывает только точный проверенный source path. Compatibility scans page-bounded and checkpointed.

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

На macOS installer не отключает старый upload agent при одном только успешном bootstrap нового процесса. Он ждёт до 30 секунд одновременно работающий Telegram worker и приватную запись `education_event_queue_listening` для его PID с `subscriptionCount=1`; только после этого выгружает `com.petr.education.upload-worker` из launchd и переименовывает plist в `.plist.disabled`. Если queue readiness не подтверждена или retirement завершается ошибкой, установка сообщает об ошибке. Старые release/assets и secrets сохраняются.

Rollback выключает source processing и сохраняет ledger/outbox для дальнейшего разбора. Не удалять очередь/registry при rollback. Перед первой эксплуатацией определить retention, алертинг и владельца ручной обработки dead letters.

### Штатные команды

```bash
npm run telegram:runtime -- readiness
npm run telegram:runtime -- source-check
npm run telegram:runtime -- upload-check --since 2026-10-18T06:30:00Z
npm run telegram:runtime -- source-check --diagnose-schedule-dates --date 2026-10-13 --date 2026-10-14 --date 2026-10-15
npm run telegram:runtime -- probe --source firestore --target-digest TARGET_HASH
npm run telegram:runtime -- probe --source mesh --target-digest TARGET_HASH --apply
npm run telegram:install-worker
npm run telegram:install-worker -- --apply
npm run telegram:status
npm run events:status
npm run telegram:stop
npm run telegram:runtime -- uninstall --apply
```

`source-check` читает динамический graph и реальные МЭШ observations всех доступных подключений без SourcePipeline/academic/outbox writes или отправок; refresh может обновить локальные tokens. Неполный охват обязан быть видимым. Сумма `excludedCalendarEvents` показывает подтверждённые календарные записи, не входящие в уроки; это не потерянные уроки и не отправки.

`--diagnose-schedule-dates` добавляет только безопасные признаки несовпадения даты: requested/start date, валидированные ISO start/finish с offset, source из конечного набора, булевы признаки предмета/ДЗ/типа и SHA256(source,id). Исходные ID, название, описание, адрес, URL и credentials не выводятся. Диагностика доступна и для complete observation после корректной классификации. Повторяемый `--date` разрешён только с этим флагом и применяется ко всем автоматически обнаруженным семьям. Это частичное диагностическое чтение: `diagnosticOnly=true`, `coverageComplete=false`, явно указаны inventory/selected/unobserved scopes и allFamilies. Такой отчёт не доказывает полный охват; для него запускается `source-check` без фильтра. Фильтр дат не настраивает runtime и не ограничивает число семей.

`upload-check [--since ISO]` проверяет текущие uploads всех автоматически найденных семей: подтверждение storage, точный контекст задания, durable bootstrap/live origin, checkpoint и фактические ledger/outbox записи по устойчивому sourceEventKey. Сверка receipts работает и после того, как файл уже вошёл в baseline; предсказание следующего eventId не подменяет поиск реальной доставки. Отчёт содержит только агрегаты, без ID/имён/заданий/URL; reads используют whitelists. `wouldEmit` — отдельная гипотеза следующего прохода; общий с pipeline нормализатор проверяет whitelist/размеры, отказ учитывается в `pipelineRejected` и запрещает diagnosticComplete. `diagnosticComplete` означает завершённую проверку выбранного окна, `coverageComplete=false` сохраняется: это не глобальный мониторинг всех событий. Команда не меняет origin/checkpoint/ledger и не отправляет сообщений (`writes=0,sends=0`).

Probe dry-run не пишет; apply использует явное `technical.probe`, точную подтверждённую link по opaque digest, отдельный служебный Firestore документ либо реальное чтение МЭШ, затем общий pipeline/ledger/outbox/transport. Exact job claim не дренирует постороннюю очередь; успешность требует readback `sent` и receipt. Это проверка технической цепочки, не естественного изменения оценки.

Installer сначала возвращает план. Apply создаёт content-addressed runtime release в закрытом Application Support, production dependencies и secret file0600. Plist содержит пути, абсолютный Node и только несекретную конфигурацию. Общие ADC/Mesh vault остаются по тем же путям, что у sync. Singleton kernel lock запрещает второй poller; потеря broker приводит к остановке. LaunchAgent RunAtLoad/KeepAlive перезапускает аварийный процесс с throttle; SIGTERM выполняет общий shutdown. Журналы и telemetry ротируются. Stop/uninstall сохраняют release, секрет и Firestore ledger/outbox для обратимого восстановления. Повторная install предыдущей версии — rollback к её content hash.

Mac должен быть включён, доступен и находиться в пользовательском сеансе; сон/выключение не обеспечивают24/7. При ограничениях macOS TCC доступ к общему vault проверяется фактическим запуском; копировать секреты в расходящиеся vault запрещено. Для непрерывной доступности на другом host требуется отдельная установка с общей политикой владения и распределённой session lease.

Готовность outbox проверяет также реальный groupId/state query (limit1 на заведомо несуществующую группу). Claim/recovery индексы сами по себе не подтверждают готовность группировки.

## Подмодули

Общие IO/session/telemetry принадлежат серверному ядру. Отдельный host runbook выносится при появлении второго deployment; новые on-call контракты создаются по реальной потребности.

`node scripts/telegram-design-preview.mjs --target-digest HASH --run-id ID [--apply|--receipt-only]` — официальный явный выпуск одной компактной сводки из3условных проверок в выбранную действующую семейную связь. Без apply выполняет только проверку адресата/шаблонов. Apply создаёт technical.probe (не фиктивные учебные события), использует ProbeNotificationService, общий immutable outbox/NotificationService/transport и адресный readback всех receipts. Один run-id идемпотентен; неполная доставка остаётся в штатной очереди и не объявляется успехом. Вывод агрегированный, без ID участников или работ. Режим receipt-only только читает агрегат состояния ранее вычисленного job без записи/отправки. CLI не запускает второго polling worker.

18.10 дизайнерская приёмка:4условных примера в подтверждённом чате,4receipts,format=rich_message; [факты и совместимость](../../decisions/telegram-design-system-2026-10-18.md). Это проверка оформления и transport, не создание новых оценок или проверок ребёнка.

`node scripts/telegram-runtime.mjs review-check [--since ISO]` — read-only диагностика всех зарегистрированных progress scopes: точность task context, finite причины пробелов, наличие baseline, свежие ledger revisions и фактические outbox/digest receipts. Только счётчики, writes=0/sends=0; missing context не считается доставкой. `sameStatusRevisions` не доказывает timestamp-only: причина явно unknown, исходный checkedAt не сохранялся в ledger. `sentDigestJobs` считает уникальные дайджесты, `eventCoveredReceipts` — покрытие исходных событий, их нельзя суммировать как отдельные Telegram-сообщения. Source-material записи не являются проверкой решения и учитываются отдельно.

Опция `--history-demo` того же CLI отправляет максимум2 явно условных сообщения: сводку трёх разных работ и продолжение одной из них через native reply на фактически прочитанный sent receipt. События ledger остаются technical.probe с пустыми fields, рабочие workRefs в outbox демо не сохраняются. Повтор стабильного run-id не пересылает sent job, частичный запуск продолжает только незавершённую часть; `--receipt-only --history-demo` читает ровно2известных job без записи/отправки. Это проверка внешнего транспорта и оформления, а не доказательство естественного учебного изменения или production history transaction; последнюю проверяют интеграционные тесты [истории работы](work-history.md).


## Восстановление зависших операций

19.10 подтверждён эксплуатационный сбой: процесс оставался running, но завершённые source/outbox spans отсутствовали больше часа. Остановка превысила бюджеты source close, delivery drain и Firestore terminate. Перезапуск восстановил обработку; транспортная первопричина пока не доказана. PID и возможность нового диагностического подключения не подтверждают здоровье старого клиента.

Проверки Telegram identity и Firestore до старта worker ограничены `TELEGRAM_STARTUP_OPERATION_TIMEOUT_MS` (600000мс) и при зависании также завершают процесс.

Deadline относится к **активной операции**, а не отсутствию изменений. Source start/reconcile и каждый source pipeline process ограничены `TELEGRAM_SOURCE_OPERATION_TIMEOUT_MS` (по умолчанию600000мс), одна итерация доставки — `TELEGRAM_DELIVERY_OPERATION_TIMEOUT_MS` (600000мс), отдельная итерация EducationSync dispatcher — `TELEGRAM_EDUCATION_SYNC_OPERATION_TIMEOUT_MS` (60000мс). Большой inventory требует подходящего операторского бюджета; количество семей не ограничивается. Настройки проверяются до запуска и передаются постоянному процессу installer.

При превышении срока worker пишет безопасный timeout code и завершает **процесс** с exit1. LaunchAgent KeepAlive запускает замену. Одного Promise.race недостаточно: неотменяемый SDK callback мог бы поздно записать данные или отправить сообщение. Новый процесс восстанавливает durable pending/outbox после истечения leases; event IDs, recipient fences и сохранённые receipts препятствуют повторной обработке. Это ограничивает зависание, но не обещает exactly-once внешнего Telegram API при потере ответа после отправки.

Обычный простой не считается зависанием; здоровая операция снимает таймер. JSONL telemetry содержит UTC `at` наряду с monotonic duration. Проверка исходников и тест с отдельным завершаемым процессом не заменяют наблюдение постоянного процесса после выпуска. Readiness проверяет предпосылки доставки; сама по себе она не доказывает свежий МЭШ poll или получение сообщения человеком.

## Проверка реальных изменений МЭШ

`node scripts/telegram-runtime.mjs mesh-delivery-check --since ISO` читает все обнаруженные разрешённые Mesh scopes, notify checkpoints, связанные natural ledger events и outbox receipts. Сравнение использует общий normalizer/diff; текущий delta не выдаётся за уже сохранённое событие. Первый bootstrap остаётся тихим. Политика disappearance не превращает отсутствие записи в удаление.

Окно применяется к `detectedAt`: оценка за прошлый день может быть получена сегодня. После baseline advance доставка проверяется по ledger и receipts, включая точное членство event job в digest. Состояние sent без фактической квитанции не является доказательством доставки; одно групповое сообщение и несколько покрытых событий учитываются отдельно. Отчёт не выводит имена, исходный текст работ, chat IDs или credentials. Event IDs — служебные opaque hashes для адресной операторской сверки.

`--limit N` ограничивает только диагностический запуск и явно выставляет truncated/incomplete; это не ограничение семей сервиса. Lease updatedAt не доказывает успешного наблюдения: отсутствующий timestamp baseline учитывается как unknown. Команда не пишет checkpoints, ledger или outbox и не отправляет сообщений. Повторное включение уже подтверждённого события в EducationSync выполняется отдельной явной командой [диспетчера](education-sync-dispatch.md).


## Education sync dispatch

[Диспетчер и подтверждение запуска](education-sync-dispatch.md) описывают отдельную устойчивую очередь запросов в существующий чат Codex, конфигурацию и границы доказательств.


Приёмка19.10 после main75b425c: постоянный LaunchAgent использует release34b3a4c68e7bf9b4556e1429,39файлов совпали с исходниками. Все93Mesh scopes успешно прочитаны со свежими baseline;5реальных событий доставлены1уникальной сводкой с receipt, pending/retry0. Запрос44320156-3b17-47e7-8498-846d469d282d автоматически запущен этим worker и завершён существующим EducationSync как completed в11:33:53UTC после полного42-дневного цикла и readback; очереди0/0/0. Постоянное разрешение на стандартные материалы отражено в [общем workflow](../../operations/education-sync.md).
