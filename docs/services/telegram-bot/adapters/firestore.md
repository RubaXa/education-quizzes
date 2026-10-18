---
id: service.telegram-bot.firestore
status: accepted
implementation: partial
created: 2026-10-16
updated: 2026-10-18
consumers:
  - "Telegram service implementer"
  - "bot operator"
  - "parents and guardians"
code:
  - packages/telegram-notifications/adapters/source-firestore.mjs
  - packages/telegram-notifications/adapters/source-inventory-firestore.mjs
parent: service.telegram-bot
uses: []
sections:
  - ответственность
  - подписка-и-обработка-сигнала
  - области-данных-для-валидации
  - пределы-доступа-и-приватность
  - масштабирование
  - проверки-перед-активацией
---
# Адаптер источника Firestore

**Родитель:** [корневая архитектура](../README.md); [порты и события](../ports-and-events.md).
**Статус:** source observer, безопасная нормализация и автоматическое inventory работают в постоянном Mac runtime; реальные upload receipts подтверждены18.10. Это не подтверждает полноту всех типов изменений. Registry/ledger описан в [контракте event ledger/outbox](../event-ledger-outbox.md).

## Ответственность

Listener наблюдает только согласованные Firestore paths, подтверждать владение записью через текущую модель семьи/владельцев, формировать нормализованные observations и передавать их в application port. Источники не определяют получателя сами и не отправляют сообщения.

## Подписка и обработка сигнала

- Для Node worker использовать серверный Firestore listener через `@google-cloud/firestore`; SDK скрыт за adapter boundary.
- Подписываться на узкие document/query paths с ограниченной областью и индексами. Paths сверены с текущими моделями; live schema/IAM проверяются перед эксплуатацией.
- Сигнал считается wake-up: получить актуальное состояние документа, проверить его owner/role links и revision, нормализовать допустимые поля.
- Учитывать повторные и переставленные события; игнорировать устаревшую ревизию. Не выводить удаление только по отсутствию документа в ограниченном query.
- Полная observation передаёт durable monotonic `observationSequence` из persistent checkpoint per scope; время fetch и случайный UUID не годятся. Повторный/меньший sequence не продвигает baseline. Sequence/checkpoint реализованы в общем SourcePipeline и Firestore checkpoint adapter.
- Listener error закрывает readiness источника, сохраняет последний подтверждённый checkpoint, сообщает operations port и пересоздаёт listener с ограниченным exponential backoff и jitter.
- При возобновлении подписки выполнить reconciliation текущего окна/курсора, чтобы закрыть разрыв между disconnect и новым snapshot.

## Области данных для валидации

Источники текущего среза: загрузки `dayUploads/.../files/{uploadId}` с `dayOwners`/семейной связью; попытки `assignments/{quizToken}` и связанный список роли; статусы `dayProgress`. Пути сверены с локальным кодом; `dayReviewPrivate` не читается. Внешняя integration проверка остаётся отдельной.

Перед включением каждой подписки записать:

| Обязательное свойство | Требование |
|---|---|
| Path и владелец | Существующий schema owner и authoritative family/child resolution |
| Сигнал | Какие поля реально меняются, откуда берётся revision и когда нужен reread |
| Полнота | Можно ли достоверно определить новое/изменённое/удалённое состояние |
| Доступ | IAM role worker и минимально необходимая коллекция/проект |
| Privacy | Семейный/командный projection; поля, запрещённые к копированию |
| Reconciliation | Как восстанавливается разрыв после падения worker |

### Реализованный increment — 17 октября

Runtime автоматически обнаруживает семьи, детей, подключённые источники и опубликованные владельцы дней через authoritative Education registry. Ручных списков family/child/scopes и продуктового лимита их числа нет. Новая семья или ребёнок добавляется без правки конфигурации и restart; отзыв источника снимает наблюдение. Внутренние descriptors создаёт inventory manager, они не являются operator allowlist. Все IDs валидируются; для каждого дня canonical `dayOwners/{dayToken}` подтверждает точную пару владельца; family/child documents должны существовать. Каноническое quiz назначение должно иметь ту же пару; legacy assignment без пары не наблюдается: для него ещё нужна отдельная подтверждённая owner linkage. Queries scoped по семье/ребёнку, страницы и очереди обрабатываются до конца; технический page size/concurrency регулирует нагрузку, но не исключает семьи. Ошибка/неполнота inventory видна в health и не становится ложным пустым списком. Failed context изолируется по source/family/child/account: сохраняется его прежний graph, а здоровые источники и дети продолжают обработку, в том числе Firestore при недоступном МЭШ.

Listener даёт только сигнал перечитать текущее состояние. Нормализация допускает подтверждённую загрузку (`pending`/`reviewed` с `storage.provider=yandex-disk`, `storage.state=stored` и валидным `storage.syncedAt`), монотонный жизненный цикл quiz (`not_started → started → submitted`) и явно подтверждённый публичный status проверки. `requested`, `awaiting-upload`, промежуточный `uploaded`, ошибки и `pending` без подтверждённых storage полей не доказывают загрузку. Стабильный `pending+stored` означает успешно переданный и проверенный storage worker файл, ожидающий педагогического разбора; это не оценка решения. Редакция timestamp сама по себе не новый quiz start. `dayReviewPrivate`, questions/answers, оригиналы и URL не попадают в checkpoint/event/log. Exact event enum берётся из domain catalog: `upload.confirmed`, `quiz.started`, `quiz.submitted`, `review.changed`.

Source pipeline сначала получает scope lease, затем читает полный допустимый snapshot. Durable sequence и безопасный pending batch сохраняются до `accept`; после сбоя повторяется тот же event ID. Baseline продвигается только после идемпотентного приёма всех events. Перед replay/accept повторно подтверждается владелец; смена владельца сбрасывает baseline/pending и не переносит прежние события новой семье. Absence не удаляет известный факт; checkpoint делится на ограниченные технические единицы/записи, чтобы предел документа Firestore не становился пределом семьи. Каждая страница/единица проходит до конца; partial/error сохраняют последнее подтверждённое состояние и явно отражаются в health. Существующий initial inventory не рассылается как история; новая entity у уже действующей подписки должна отличаться от исторического bootstrap, включая restart.

Shadow и notify используют разные checkpoint namespaces: shadow никогда не вызывает `accept` и не создаёт outbox; первый notify snapshot тоже тихий. Перезапуск прежнего notify namespace сохраняет recovery, а не начинает заново историю. Локальные регрессии и wiring проверяются общим gate; реальные IAM/index/listener checks остаются отдельным эксплуатационным подтверждением.

### Контекст загрузки и защита от повторов

Реальный upload lifecycle описан в [контракте хранения](../../../modules/materials/storage-privacy.md#review-queue): после передачи `uploaded` быстро меняется на подтверждённый `pending`. Listener может перечитать уже это конечное состояние. Нельзя требовать, чтобы адаптер успел увидеть промежуточный `uploaded`.

Сообщение связывает точный `taskId` загрузки с заданием/подпунктом только в проверенной `dayPages/{dayToken}` того же owner. `page.kind=student`, `page.date=owner.date`, taskId входит в page.taskIds; `targetDate` — срок задания, он может отличаться от даты страницы. Имеющиеся поля familyId/childId страницы не должны противоречить owner. Общая чистая функция task context используется inbox и Telegram; оригиналы, URL/пути хранения, ID и содержимое фото не входят в проекцию. Разрешены краткие `subject`, `title`, дата задания и имя ребёнка. Соседние задачи (`relatedTasks`) не означают решённые номера; служебные processing lists не расширяют утверждение сообщения о содержимом фото.

`upload.confirmed` — однократный логический факт появления конкретного файла. Переход `uploaded→pending→reviewed`, обогащение заголовка/предмета, перестановка и повторный сигнал не становятся повторной загрузкой. Известная запись обновляет baseline без нового upload event. Первая история нового ребёнка остаётся тихой; миграция прежней пустой bootstrap-проекции не должна массово разослать старые файлы. Новая загрузка уже подтверждённого live-контекста должна породить событие, в том числе после исправления неверного фильтра статусов. Миграционная неопределённость отражается явно, без выдуманной истории.

### Контекст проверки и смысл изменения

`review.changed` требует точной связи progress item с заданием той же страницы и владельца через общий `taskContext`. Статус без предмета и названия задания не является пригодным сообщением. Недоступная или противоречивая связь означает partial observation: baseline не продвигается, восстановление повторяет адресное чтение. Закрытые разборы и ответы для этого не читаются. Разрешены только краткие предмет, название, дата задания, имя ребёнка и публичный статус.

Повторная запись `checkedAt` и добавление/изменение подтверждённого контекста задания не создают новое уведомление. Fingerprint результата учитывает статус, отсортированный набор `uploadIds`, а также содержимое ученически доступных `summary` и `nextStep`; весь fingerprint сохраняется только как SHA-256, сами upload ID и тексты в source record/checkpoint event не переносятся. Эти поля читаются одной маской с learner-readable `dayProgress`; `dayReviewPrivate` не читается. Новая версия review-проекции хранится в `reviewProjectionVersion`, отдельно от upload `sourceProjectionVersion: 2`. При первой миграции baseline без review-версии прежний status не переотправляется, но реальная смена статуса всегда создаёт событие. После тихой миграции новый fingerprint при том же статусе означает новый результат. Проверяются новая попытка с тем же статусом, смена набора фото/содержания, перестановка ID, timestamp/context-only, перезапуск и неполная страница.

## Пределы доступа и приватность

Серверный Firestore SDK авторизуется через IAM/ADC и обходит Firebase Security Rules. Worker получает отдельную минимально привилегированную identity. Не помещать service account key в репозиторий. Не логировать raw snapshot, ответы теста, закрытый разбор, токены и содержимое файла. Сохранять только необходимые source reference, revision и безопасный event projection.

## Масштабирование

Пока один worker владеет listeners и checkpoint namespaces. При горизонтальном масштабировании нужна явная lease/partition ownership для scope и независимая идемпотентность ledger; простое дублирование процесса даст повторные reads и лишние сигналы, даже если доставка дедуплицируется.

## Проверки перед активацией

Фикстуры на создание/изменение/удаление, отсутствующий owner, смену owner, out-of-order revision, repeated trigger, transient listener failure и reconnect reconciliation. Сначала запускать adapter в режиме наблюдения без отправки; сравнить events с подтверждёнными документами и журналом.

Для подтверждённого upload source добавляет navigationContext только после owner/dayPage/exact task membership проверки. Порт переносит лишь kind=day, dayToken и валидный taskId; произвольные source URL не становятся кнопкой. Контекст не меняет устойчивую семантику загрузки и не вызывает повторную рассылку при обогащении baseline.

Кнопка появляется только после проверки точных page.familyId/childId и viewTokens: student совпадает с scope.dayToken, обе роли имеют разные допустимые tokens. Для legacy страницы без полной metadata либо с неподтверждённым alias факт загрузки и сообщение сохраняются, navigationContext опускается. Поле viewTokens добавлено к маске уже существующего адресного чтения без нового запроса.
