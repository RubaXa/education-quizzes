---
id: shared.server-runtime
status: accepted
implementation: partial
created: 2026-10-17
updated: 2026-10-19
parent: shared.data
uses:
  - module.families
  - module.school-diary
  - module.synchronization
consumers:
  - education-sync operator CLI
  - Telegram worker
  - runtime operator
code:
  - "packages/education-runtime/credentials.mjs"
  - "packages/education-runtime/family-graph.mjs"
  - "packages/education-runtime/firestore.mjs"
  - "packages/education-runtime/identity.mjs"
  - "packages/education-runtime/mesh-session.mjs"
  - "packages/education-runtime/telemetry.mjs"
sections:
  - назначение
  - границы-и-порты
  - авторизация-и-совместимость
  - телеметрия
  - проверка-и-эксплуатация
---

# Общее серверное ядро Education

## Назначение

Ручной `sync:project` и Telegram worker используют один пакет `packages/education-runtime` для Firestore/ADC, семейного графа, проверок владельца, Mesh child-session, credentials и телеметрии. Оператор сохраняет прежний CLI wrapper; Telegram сохраняет собственные source, identity и delivery adapters. Предметное решение, публикация учебных данных и outbox доставки не сливаются. Эти модули работают в исходниках; это не подтверждает deployment или live delivery.

## Границы и порты

Общий серверный пакет `packages/education-runtime` содержит production `@google-cloud/firestore` factory с явным project ID и ADC resolution, пагинированный family graph repository, чистые identity/owner predicates, Mesh child-session service, token-only credential store с cross-process account lock и общую telemetry port. Production worker и его dispatch CLI используют этот factory и типы `@google-cloud/firestore`; `firebase-admin` остаётся dev-only для старых операторских CLI и не импортируется в Telegram production import graph. Регрессионный тест проверяет замыкание зависимостей этих графов относительно `dependencies`. Эти модули не импортируют Telegram или operator scripts. `scripts/lib/admin-firebase.mjs` — совместимая оболочка для старых операторских вызывающих сторон; она не вводит второй Firestore SDK. Публичный connector сохраняет MeshDiaryAdapter; ядро создаёт свежий адаптер для каждого разрешённого ребёнка. SDK, файловые операции, clock и telemetry внедряются для тестирования без внешних систем.

Family graph проходит все страницы без списка/лимита семей. Сбой одной семьи сохраняется как partial failure, а независимые здоровые семьи продолжают инвентаризацию; частичный граф не считается полным. Consumer projections создают sync targets и notification scopes, используя общие строгие predicates. Общий `event-queue.mjs` владеет ingress claim/lease/retry/fanout; Telegram сохраняет транспортный outbox, а `operatorSyncJobs` — исполнение педагогических задач. Это один вход событий с отдельными состояниями потребителей, без параллельных бизнес-очередей. [Контракт очереди](../modules/synchronization/event-queue.md) задаёт единственную subscription, атомарные producers и ограниченную переходную сверку старых PWA. Mesh HTTP retry существует в connector; повтор source observation не создаёт второго HTTP retry.

## Авторизация и совместимость

Проверяется точная family/child/sourceAccount/sourceIdentity пара, активная семья/ребёнок, действующее родительское членство, actor hash и профиль ребёнка в МЭШ; проверка повторяется после внешних calls. Отдельный child adapter и account-scoped сериализация не допускают смешивания siblings. Legacy credentials допустимы только через явно выбранный codec, который доказывает прежнюю family-access `legacyDayOwner`, actor hash и точную пару в текущем source registry. Отсутствующий или неверный registry match блокирует legacy путь; нет неявного fallback к несвязанному `secret.json`. Новые source accounts используют канонический connection store.

Отказ OAuth `invalid_client`/`invalid_grant` и HTTP401/403 не превращается в
`mesh_unavailable`: session сохраняет безопасный `mesh_auth_required`. В закрытой
квитанции сбора остаются stage, HTTP и код OAuth из фиксированного списка;
URL, тело ответа и секреты отбрасываются. CLI показывает необходимость повторного
входа, а не общий сетевой сбой. Сначала используется `client_credentials` уже связанного динамического клиента
mos.ru; этот механизм повторного входа не зависит от срока SSO-сессии.
`refresh_token` — запасной путь, когда основной не выдал доступ. `invalid_client`
останавливает обновление: та же отозванная пара не исправляется сменой grant.
Ошибка сети остаётся отдельной; ошибки сохранения обновлённого токена не теряются.
После повторного входа всё равно необходимы проверка владельца и свежий сбор.
Новый вход отдельно сообщает безопасный этап/HTTP/разрешённый код через общий
login-diagnostics; логин виден локально, пароль и SMS скрыты. Сбой регистрации
не означает ошибку пароля. Пакет0.1.1 включает диагностику; локальная сборка
и успешная реальная авторизация — разные результаты.
Для локального запуска есть `npm run connect:diagnose -- --invite <код>`; он
использует текущий checkout, без npm-загрузки. `--check` проверяет только среду.
Диагностика выдаёт безопасные HTTP-статусы; отдельные файлы не создаются.

Token refresh сохраняет только общие token/refreshToken, атомарно и с режимом `0600`, не подменяя child profile. Межпроцессный доступ sync и worker к одному account сериализуется общей kernel advisory lock на постоянном inode через Python3/fcntl broker, с ограниченным ожиданием и автоматическим освобождением ОС при завершении владельца. Lock-файл не удаляется и не переименовывается по mtime/PID. Python3 с fcntl — требование текущего macOS/Linux host; при отсутствии broker доступ закрывается. Это single-host lock, а не распределённая блокировка. Инструмент различает недоступные credentials, неполный источник и отсутствие данных.

## Телеметрия

Один `TelemetryPort` для обоих consumers: trace/span/parent IDs, monotonic duration, operation/stage, consumer/source, safe outcome и счётчики SDK/HTTP attempts, retries, cache hits/misses и ожидания account lock. Одинаковые операции используют общие имена и единицы. Идентичности — opaque hashes; имён, исходных URL, текста сообщений, токенов, ответов и raw exceptions в trace нет. Общая wall duration и перекрывающиеся spans показываются отдельно; суммы parallel spans не объявляются временем запуска. Firestore SDK returned-document counters учитываются инструментированным клиентом один раз; graph projection/page counters отдельны. SDK calls/document delivery не выдаются за billed Firestore reads.

Каждая завершённая JSONL запись содержит UTC at и monotonic duration; отсутствие завершённых операций нельзя подменять проверкой PID. Active operation watchdog Telegram завершает зависший процесс, а постоянный host восстанавливает его по [операционному контракту](../services/telegram-bot/operations.md#восстановление-зависших-операций).

Локальный JSONL sink с rotation и0600 — первый exporter, интерфейс допускает внешний exporter без изменения use cases. Trace context передаётся из operator wrapper в дочерний CLI и из source observation в логи приёма/доставки через устойчивые event IDs. Ошибка exporter не должна менять учебные данные или ломать доставку; пропуски telemetry видимы счётчиком.

## Проверка и эксплуатация

Проверки исходников покрывают owner/revocation/legacy/multiple-account cases, pagination/partial family failure, child-isolated sessions, cross-process account contention, refresh persistence failure и redaction/counter contracts. Это регрессии реализации, не нагрузочное доказательство. Synthetic load run с параметрами графа, p50/p95, wall time, memory/read counts и пределами доказательства ещё нужен; продуктового cap семей нет, ёмкость одного хоста не установлена.

Первый срез17.10 сам не доказывал реальную цепочку. Актуальная [приёмка19.10](../decisions/telegram-sync-recovery-2026-10-19.md) различает93/93complete Mesh scopes,5natural событий с1Telegram receipt и отдельно подтверждённый запуск общего EducationSync. Полная публикация sync имеет собственные зависимости/блокировки; диагностические данные не маскируются под оценки/ДЗ. Постоянный процесс должен получать секреты вне Git/argv/plist, поддерживать singleton/restart/backoff, ротацию журналов, status и rollback. Локальный LaunchAgent работает только при доступном Mac/сеансе; это не обещание доступности выключенного хоста. Telegram привязка требует подтверждения пользователя в личном чате и текущего семейного права; тестовый получатель не выводится из username или догадки.
