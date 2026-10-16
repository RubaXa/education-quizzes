---
id: audits.telegram-self-review-2026-10-16
status: reference
implementation: not-applicable
created: 2026-10-16
updated: 2026-10-17
consumers:
  - "Technical lead"
  - "Telegram service developer"
  - "Telegram bot operator"
code: []
parent: service.telegram-bot
uses:
  - service.telegram-bot
  - service.telegram-bot.ports-and-events
  - service.telegram-bot.identity-and-linking
  - service.telegram-bot.event-ledger-outbox
  - service.telegram-bot.delivery
  - service.telegram-bot.operations
  - shared.specification-system
sections:
  - область-и-метод
  - сделано-и-не-сделано
  - независимые-находки
  - технический-триаж
  - проверки-и-границы
  - recheck-2026-10-17
  - fixes-2026-10-17
---

# Независимый self-review Telegram-сервиса — 16 октября 2026

## Область и метод

Self-review выполнен независимым агентом модели Luna без контекста выводов root, в режиме read-only на commit `acdfced2de811931991fafa19fbe6b4e61b69605`. Исходный независимый отчёт сохранён приватно без изменения выводов. В текущем checkout сверены локальные исполняемые пути `@agi_edu_bot`, дочерние спецификации, metadata/generated status, file-map и вызовы в коде. Это аудит checkout и контрактов, а не свидетельство production deployment. Внешние интеграции, реальные Firestore документы и Telegram polling не запускались.

## Сделано и не сделано

| Область | Сделано в исходниках | Не сделано / граница |
|---|---|---|
| Specification system | Frontmatter, ID, parent/uses, headings/sections, ссылки/якоря, file-map и `@see` валидируются; граф строится детерминированно (`scripts/spec-graph.mjs`, `scripts/check-docs.mjs`). | Граф, backlinks и verified-by показывают трассировку/связь с тестом, но не доказывают полноту поведения или deployment (`docs/shared/specification-system.md`, раздел «Граф» и «Проверки»). |
| Entrypoint/config | `scripts/telegram-bot.mjs check` делает identity check; явный worker проверяет конфигурацию, Telegram identity и Firestore access. | Нет hosted deployment, выбранного production host, IAM rollout и readiness/alerting (`docs/services/telegram-bot/operations.md`, разделы Runtime и Развёртывание). |
| Telegram identity | Личный `/start` регистрирует numeric Telegram account; подтверждённый `/stop` отключает выбранную существующую link (`identity.mjs`, `telegram.mjs`, Firestore registry adapter). | Trusted issuer/authorizer и оба PETR UI flow для создания link отсутствуют; существующий account не получает доступ к семье от одной регистрации (`identity-and-linking.md`, разделы «Привязка» и «Данные и доступ»). |
| Event core | Нормализация event, field whitelist, snapshot diff и identity есть (`domain/events.mjs`, `domain/diff.mjs`). | SourceObservation producers и bridge к API `diffCompleteSnapshots` отсутствуют; observations не проходят через worker. |
| Firestore/MЭШ sources | Firestore используется для account registry, ledger/outbox и membership checks. | Education source listeners, owner resolution, durable source checkpoints, МЭШ poller и source mappings не реализованы/не подключены (`adapters/firestore.md`, `adapters/mesh.md`; оба implementation planned). Наличие `mesh-diary` в dependencies само по себе не означает импорт в Telegram runtime. |
| Recipients/delivery | Family recipient resolver проверяет active link и текущую parent membership; message parts имеют durable receipts; Telegram adapter и outbox retry/recovery существуют. Delivery включается только `--enable-delivery`. | Нет team resolver/route, group/digest 30/60 секунд и end-to-end обнаружения событий. Worker может отправлять только jobs, уже находящиеся в outbox. |
| Связь с существующим Education | Источниками истины остаются отдельные документы Education; отдельный in-app inbox имеет собственные producers/storage. | В проверенном Telegram runtime нет кода, связывающего in-app inbox или существующие Education producers с Telegram `accept`; новый observer — отдельная planned функция. |

## Независимые находки

1. **Карта файлов отставала от кода.** Прежняя формулировка `docs/file-map.md` для Telegram root говорила, что worker ещё не реализован и описывала его как будущий, хотя `scripts/telegram-bot.mjs` и `packages/telegram-notifications/adapters/worker-loop.mjs` уже содержат локальный явный worker. Hosted deployment при этом действительно не настроен. Карта обновлена так, чтобы различать существующие части и planned source adapters.
2. **DTO observation и diff API требуют явного bridge.** `ports-and-events.md` задаёт целевой DTO с `completeness: complete|partial|unknown`, `observedAt`, `cursor`; `domain/diff.mjs` принимает boolean `complete`, обязательный durable `observationSequence` и отдельный `detectedAt`, вместе с `source`, `scopeKey`, `familyId`, `childId`. Реализованный producer/bridge отсутствует. В этом документе обе формы теперь разведены, но будущему adapter всё ещё нужен fixture/contract test.
3. **Портовый список смешивал цель и текущий minimum.** Например, source observation, token issuance, team routing, grouped renderer и time windows описывались рядом с действующими ledger/identity/delivery primitives без статуса по каждому capability. Таблица `ports-and-events.md` теперь явно разделяет implemented minimum и planned/unwired capabilities.
4. **Event при нуле получателей — открытый вопрос только для ранее авторизованных получателей.** Код может зафиксировать event без jobs и подавить повторное создание job при replay того же event ID (`application/notifications.mjs`, `adapters/firestore.mjs`). Историческая рассылка при первой привязке запрещена. Не предлагать catch-up новому link; отдельно определить поведение временной гонки или ошибки routing для получателя, который уже был авторизован на момент события. Production loss не установлена.
5. **`queued` при orphan job — низкоприоритетный непокрытый риск.** `recordIfAbsent` считает verified targets, не исключая уже существующие job refs, если event document отсутствует. Это может завысить ответный счётчик в частичном/legacy state; факта такого состояния в реальном Firestore не установлено, production-инцидентом не является.
6. **Draft продукта и accepted архитектура не противоречат сами по себе.** `docs/product/notifications.md` сохраняет рабочие бизнес-гипотезы/неутверждённые решения, а сервисные документы принимают архитектурные границы и реализационный минимум. Метаданные описывают разные уровни решения; оснований трактовать различие статусов как установленное противоречие нет.
7. **Проверка локальных ссылок не подтверждает внешние private references.** Публичный `check:spec` проверяет документы и якоря в своём checkout. Спецификация системы прямо относит `petr-private:` к provenance, который не проверяется внутри этого репозитория (`docs/shared/specification-system.md`, раздел «Проверки и приватные границы»). Поэтому для внешних private anchors нужна отдельная проверка в источнике; результат локального green gate не распространяется за границы checkout.

## Технический триаж

- **Сделать перед подключением source adapters:** зафиксировать bridge `SourceObservation → diffCompleteSnapshots`, включая семантику sequence/checkpoint, scope `(familyId, childId, sourceAccountId)`, время observation vs detection и поведение partial/unknown. Добавить контрактную fixture проверку.
- **Решить для routing failure:** определить replay/route для уже авторизованного получателя при временной гонке или ошибке routing. Сохранить запрет исторической рассылки при первой привязке; это отдельная граница.
- **Оставить как низкоприоритетную проверку:** считать только новые jobs в `queued` result и добавить тест на orphan job. Данных о production occurrence нет.
- **До реального включения доставки:** завершить Firestore/MЭШ observers, team route/grouping согласно бизнес-решениям, проверить scoped indexes, минимальные IAM, secrets, hosted lifecycle и rollout. Наличие runtime foundation не подтверждает выполнение этих условий.
- **Документация:** file-map и портовый контракт уточнены; generated status не редактировался вручную. Разница `draft` продукта и `accepted` сервисных контрактов оставлена, так как она отражает разные уровни готовности.

## Проверки и границы

Техлид запустил полный `npm run check`: прошли 526 тестов в 124 файлах. Независимый read-only агент тесты не запускал. После документационных исправлений техлид отдельно запустил `npm run specs:generate`, `npm run check:spec` и `git diff --check`: 145 канонических документов, 555 узлов, 1009 связей; UI-контракт без расхождений. Runtime в ходе этого review не менялся. Реальные Telegram/Firestore/MЭШ интеграции, авторизация/права целевого проекта и production deployment не проверялись. Статические спецификации и локальные тесты не подтверждают эти интеграции.

В приватном протоколе самопроверки найден и исправлен старый якорь на раздел AGENTS, исчезнувший при миграции. Приватный валидатор сейчас отбрасывает fragment ссылки и проверяет существование файла; расширение его проверки на якоря остаётся открытым. Приватные `check_session_bootstrap.py` и `self_review.py` прошли, но этот результат не закрывает описанный пробел.

Основные свидетельства: [entrypoint](../../scripts/telegram-bot.mjs), [runtime composition](../../packages/telegram-notifications/adapters/runtime.mjs), [ledger/outbox adapter](../../packages/telegram-notifications/adapters/firestore.mjs), [snapshot diff](../../packages/telegram-notifications/domain/diff.mjs), [unit tests](../../packages/telegram-notifications/notifications.test.mjs), [реестр статусов](../generated/status.md).

## Повторный fact-check — 17 октября {#recheck-2026-10-17}

Повторно проверен тот же HEAD `acdfced2de811931991fafa19fbe6b4e61b69605` с локальными документационными правками. Runtime не изменён. Техлид воспроизвёл случаи на синтетических данных; Luna отдельно проверила соответствующие исходники и отсутствие нужных проверок в тестах. Это повторная сверка уже знакомым worker, а не второй независимый аудит с чистым контекстом. Исходный отчёт от 16 октября выше сохраняет историю, но его положительные оценки snapshot validation ограничиваются следующими находками.

| Находка | Доказательство и влияние | Состояние |
|---|---|---|
| Нестрогий признак полноты | `diff.mjs:35` использует truthiness: `complete: 'partial'`, `'unknown'` и `1` дают `advanced: true` и одно событие при остальных валидных полях. Нарушается заявленный boolean-контракт; потенциально продвигается неверный baseline. | Подтверждено воспроизведением; исправить до подключения источников. |
| Повторное хэширование context refs | `events.mjs:51-52` всегда хэширует ref ID; повторная нормализация меняет его при неизменном eventId. `NotificationService.accept` повторно нормализует входное событие (`notifications.mjs:23`). | Подтверждено воспроизведением; исправить до подключения контекстных ссылок. Текущий diff не создаёт refs, renderer их не выводит. |
| Тест полноты проверяет другой отказ | В `notifications.test.mjs:76` отсутствует `detectedAt`; возврат происходит в `diff.mjs:6`, до проверки snapshot. С тем же отсутствующим timestamp тест получает ожидаемый отказ и при `complete: true`. | Подтверждено по ветке кода и воспроизведением; добавить независимые сценарии с валидным временем и неверными типами. |
| Реестр не учитывает блокировку канала | Adapter регистрирует start/stop/callback, обработчика изменения Telegram membership нет. При `403` application отмечает job как blocked; account/link не обновляются. | Подтверждено чтением кода; реестр жизненного цикла канала неполон. Блокировка канала и отзыв семейного доступа должны оставаться разными состояниями. |

[Машиночитаемые результаты и воспроизведение](telegram-recheck-2026-10-17.json) фиксируют синтетические inputs/outputs и SHA-256 исходников. Эти находки не исправлены в runtime в рамках ревью. Статус сервиса остаётся `partial`; автоматическое наблюдение источников, семейный issuer/UI, группировка и production rollout по-прежнему отсутствуют.

**Проверки 17 октября:** `npm run check` снова завершился успешно: 526 тестов в 124 файлах, structural/read-site gates и lint прошли. `build-site.mjs` пропустил повторную сборку по неизменному fingerprint; свежую сборку в этом прогоне не выполняли. `check-docs` до добавления этого дополнения проверил 145 спецификаций за 269 мс. Внешние API, polling, Firestore writes и Telegram delivery не запускались. Зелёный набор тестов не опровергает воспроизведённые дефекты.

Дополнительно исправлен оставшийся в корневой спецификации текстовый путь `docs/product/file-map.md`: фактическая карта находится в `docs/file-map.md`. Пути заменены Markdown-ссылками, чтобы они попадали под проверку ссылок. Наличие корректного графа не гарантирует корректность всех путей, написанных обычным текстом.

**Самоанализ техлида:** первое ревью слишком доверяло названиям тестов и общему зелёному результату. Для отрицательного сценария нужно проверять, что вход достигает нужной ветки, а для нормализатора — повторное применение ко всему DTO, не только стабильность eventId. Формулировка «регистрация и отключение реализованы» относится к start/stop существующей link, а не ко всему жизненному циклу аккаунта/канала. Все прочие статусы прежнего ревью сохранены с указанными ограничениями.

## Исправления после повторного fact-check {#fixes-2026-10-17}

По прямому запросу пользователя Luna реализовала исправления, техлид проверил diff и повторил targeted tests. Исторические разделы и [JSON с исходными результатами](telegram-recheck-2026-10-17.json) выше описывают состояние **до ремонта**; их SHA и failing outputs не должны совпадать с исправленными исходниками. Действующее решение — [ремонт Telegram foundation](../decisions/telegram-review-fixes-2026-10-17.md).

| Найденная проблема | Подтверждённое исправление |
|---|---|
| Truthy completeness | `current.complete` и `previous.complete` принимаются только при `=== true`; неверные типы проверяются с корректным detectedAt, в том числе без исходного baseline. |
| Повторное хэширование context refs | Нормализованные sha256-v1 refs сохраняются при повторном createDomainEvent; сырые ID по-прежнему хэшируются. |
| Недиагностичный partial test | Старый тест исправлен: valid detectedAt, отдельные asserts исходного baseline/advanced. Invalid timestamp проверяется отдельно. |
| Состояние канала | Account channel state отдельно от family links; аутентифицированные private membership events и Start, ordered/versioned updates, first-seen account, запрет stale reset. 403 означает unavailable, не доказанный user block. |
| Счётчик queued при orphan job | Memory и Firestore считают только новые jobs; существующее задание не перезаписывается. |
| Приватные якоря | Локальный PETR self_review теперь проверяет anchors, Unicode/encoding и исключает код/комментарии. 17 регрессионных тестов прошли; приватные tools/tests сохраняются локально. |

Дополнительно проверены delayed403 после нового подтверждения, same-second Telegram ordering, допустимый недельный reset update ID, ошибочное/подменённое membership событие, недоступный канал, временная ошибка чтения channel state и ошибка записи marker с lease recovery. FakeFirestore проверяет локальную логику adapter, не реальную инфраструктуру.

RED worker: 8 failed / 27 tests. После исправлений и дополнительных cases root повторил 33/33 Telegram tests. Полный `npm run check` прошёл после обновления графа и decision fingerprints: 540 тестов в 124 файлах, 146 канонических документов, 557 узлов/1016 связей, 380 классифицированных read sites, lint без ошибок. Повторная сборка сайта пропущена по неизменному fingerprint. Исходные синтетические воспроизведения техлида теперь подтверждают отклонение неверной полноты и идемпотентность всего нормализованного DTO. Источники МЭШ/Firestore, bridge/checkpoints, семейный issuer/UI, группировка, team routing и production rollout остаются незавершёнными. Политика replay для ранее авторизованных получателей остаётся открытой; этот ремонт её не подменяет рассылкой истории новым связям.
