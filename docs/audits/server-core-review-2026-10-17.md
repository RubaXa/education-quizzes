---
id: audit.server-core-review-2026-10-17
status: accepted
implementation: not-applicable
created: 2026-10-17
updated: 2026-10-17
parent: shared.server-runtime
uses:
  - service.operator-cli
  - service.telegram-bot
  - module.synchronization
consumers:
  - Technical lead
  - Runtime maintainer
  - Education operator
code: []
sections:
  - исходное-состояние
  - единые-владельцы
  - критерии-приёмки
  - результаты-проверки
  - пределы-доказательства
---

# Общее ядро sync и Telegram: архитектурная ревизия

## Исходное состояние

Срез до этого increment: commit `1fea52e`,622 локальных теста. Telegram sources подключены в коде, реальная доставка и постоянный процесс не подтверждены. Ручной education-sync использует Operator CLI и `scripts/sync-project.mjs`.

| Механизм | Обнаруженное положение | Решение |
|---|---|---|
| МЭШ SDK/retry | Оба пути уже используют MeshDiaryAdapter и один fetchMeshRead | Сохранить единственного владельца; добавить внедряемый observer попыток |
| Family graph | Sync читает глобальные коллекции без pagination, бот имеет отдельный пагинированный обход | Общий graph repository; отдельные consumer projections |
| Ownership | Проверки actor/identity/member разошлись; Telegram строже | Общие predicates/session guard, сохранить строгую проверку и post-call revalidation |
| Credentials | Два token-only callback writer, разные ошибки/валидация; legacy только sync | Один atomic store с явным legacy codec и доказанной связью; не копировать секреты в независимый runtime store |
| Конкурентный refresh | У бота только process-local mutex, sync живёт отдельно | Общая межпроцессная account lease/lock на одном хосте |
| Cache | Sync memoizes один child/run, бот хранит60-секундную безопасную projection | Общий scoped single-flight механизм где он применим; политики времени жизни различаются и не смешивают детей |
| Firestore bootstrap | Operator admin helper с локальным ADC, бот требует отдельную env конфигурацию | Общая server factory/credential resolution, обратная совместимость operator wrapper |
| Измерения | Sync private timing и operator elapsed, бот только health codes | Единый TelemetryPort, trace context и безопасные counters; прежние receipt fields сохраняются |
| Эксплуатация | Нет Telegram host installer/status/rotation; нет готовой доверенной семейной привязки | Штатные operational команды с tests/readback, без обхода family authorization |
| Документация | ARCHITECTURE всё ещё пишет «runtime отсутствует», отдельные file-map строки planned | Сверить действующие карты со статусом кода и отдельным фактом deployment |

## Единые владельцы

[Общий server runtime](../shared/server-runtime.md) содержит механизм доступа к источникам. Operator application отвечает за сбор/подготовку/проверенную публикацию учебных данных; notification application — за deterministic event mapping и outbox. Общая инфраструктура не означает автоматическую педагогическую проверку и не заменяет readback.

Расширение задаётся интерфейсом adapter/repository/credential provider/telemetry exporter, с внедрением зависимостей. Отдельный микросервис или универсальный plugin DSL для текущих consumers не нужен. Существующий граф спецификаций сохраняется. Применяется цикл требование → контракт → конкретный RED → GREEN → квитанция с постусловиями → независимое смысловое ревью. Параллельные входы сравниваются семантически, исключая runId/timestamps/timing, а не побайтово.

## Критерии приёмки

1. Оба реальных consumers импортируют общее ядро, прежние writer/owner/graph копии удалены либо являются тонкими compatibility exports.
2. Проверяются owner revocation, siblings, missing/partial families, legacy exact binding, refresh persistence failure и одновременный sync/worker.
3. Telemetry связывает source → processing → SDK/write/readback → delivery по trace/event IDs и показывает cache/lock/retry. Нет PII/credentials/raw payload; failed exporter учитывается отдельно.
4. Synthetic load использует реальные shared modules с fake IO, явно указывает N families/children/scopes/signals, p50/p95, wall/memory и SDK counters. Живые источники не подвергаются нагрузочному потоку.
5. Реальные ограниченные технические probes проверяют Firestore listener и authenticated Mesh read, общий pipeline/outbox и доставку в подтверждённый private Telegram channel. Фиксированный technical.probe не выдаётся за новую школьную оценку или ДЗ. Учебные документы для теста не меняются.
6. Постоянный host имеет singleton/restart/throttle, секрет вне argv/plist/Git, ротацию, status, stop/rollback и подтверждённый процесс. Отсутствие пользовательской привязки остаётся явной блокировкой, не основанием её подделать.

## Результаты проверки

Реальные getMe и Firestore connectivity подтверждены. Пользовательский код private Start погашен штатным trusted CLI; проверено текущее parent membership и exact local source owner. Две явные технические пробы (Firestore и МЭШ) прошли SourcePipeline → ledger → exact outbox job → Telegram; readback обеих: `sent`, одна part receipt. Учебные документы для этих проверок не менялись; естественного изменения оценки этот опыт не доказывает.

Полный реальный Mesh source-check: одна подключённая семья, один ребёнок, один account;93 области,90 полных и3 неполных schedule observations (`schedule_date_mismatch`: дата start_at не совпадает с запрошенной областью),132 нормализованные записи. Неполные снимки не приняты. Первый полный проход171.7с,508 HTTP attempts,1776 доставленных SDK документов; это не billed reads. Строгая повторная owner revalidation и новые child sessions на scope дают заметную стоимость; оптимизация должна сохранять revocation/freshness и изоляцию детей. Полный охват пока не объявлен зелёным.

[Воспроизводимый synthetic отчёт](server-runtime-load-2026-10-17.json) содержит точные исходные fingerprints, Node/platform, конфигурацию и raw aggregate metrics. Сценарии1/100/1000семей по2ребёнка и плотный50семей×2ребёнка×85областей; concurrency8, повторные сигналы и один восстанавливаемый сбой. Во всех сценариях полный охват, уникальные jobs, все доставлены в memory transport. В плотном сценарии bounded telemetry buffer отбросил7212 spans; счётчик пропуска видим, pipeline latency измеряется отдельно от усечённого span sample. Firestore/Telegram IO синтетические, сетевые quotas и реальная пропускная способность этим не измеряются.

Ревью root/Luna выявило и устранило: двойной documents-returned counter, отсутствие document ID в owner predicate, потерю singleton broker без остановки, startup cleanup scope, отсутствие worker в launch argv, слишком короткий launch shutdown timeout, false-positive readiness при остановленном host, пропуск source coverage, расхождение миллисекунд при TTL pairing и вставку кода в raw TTY. Эти случаи защищены регрессиями. После первоначального25с deadline исправлены отмена pagination/discovery/Mesh, ограниченное8-way подтверждение origins и bootstrap teardown race. Повторный реальный SIGTERM: source close983мс, Telegram stop72мс, Firestore terminate1.4мс; exit0 и новый PID подтверждены. Повторная install завершилась успешно, readyForDelivery перепроверяется. Глобальный UI baseline сохранён. Полный `npm run check`:722 теста/149файлов,150 спецификаций и451 классифицированный read site; lint без ошибок (старые предупреждения UI сохранены), frontend fingerprint прежний.

Оба требуемых outbox composite indexes добавлены адресно и подтверждены READY; прочие индексы не менялись. macOS LaunchAgent releasef87008027b4453cf68b56e8a запущен с источниками/доставкой, штатная readiness подтвердила running, exact legacy owner,1 активную семейную link и оба outbox query preflight. Секрет0600 вне plist/argv/Git, общий vault с operator sync; фактическая постоянная работа ограничена включённым Mac и пользовательским сеансом.

## Пределы доказательства

Unit/fake integration не доказывает реальную сеть, права IAM и внешнюю доставку; real API probe не доказывает масштабную ёмкость. Техническое событие доказывает путь транспорта после чтения источника, но не возникновение настоящего изменения оценки. Telemetry не заменяет квитанцию и не равна billed reads. Локальный LaunchAgent зависит от доступного Mac/сеанса; нагрузочный результат одного хоста не является обещанием бесконечной производительности.

Проверенный набор расположен в изолированной ветке `codex/telegram-shared-runtime` от1fea52e: параллельные UI изменения другого чата исключены. Полный check в этой копии:722теста/149файлов; артефакт benchmark fingerprints совпадает с исходниками.

Реальный pre-push из linked worktree выявил наследование GIT_DIR/GIT_WORK_TREE временными Git fixtures. Оба тестовых harness очищают Git-local/config environment перед fixture Git, checker и Lefthook; повтор10/10 под таким окружением сохранил HEAD, tree и staged names. Hooks не отключаются.
