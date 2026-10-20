---
id: service.telegram-bot.education-sync-dispatch
status: accepted
implementation: partial
created: 2026-10-19
updated: 2026-10-19
parent: service.telegram-bot
uses:
  - shared.server-runtime
  - service.telegram-bot.operations
  - service.telegram-bot.mesh
  - service.operator-cli
  - module.synchronization.execution-artifact
consumers:
  - Telegram worker
  - EducationSync workflow
  - Education operator
code:
  - packages/telegram-notifications/application/education-sync-dispatcher.mjs
  - scripts/education-sync-dispatch.mjs
sections:
  - назначение-и-границы
  - события-и-устойчивость
  - запуск-и-подтверждение
  - конфигурация-и-эксплуатация
  - проверки-и-статус-выпуска
---

# Автоматический запрос EducationSync

Контракт готового закрытого плана исполнения, freshness и no-op dispatch задаёт [execution artifact](../../modules/synchronization/execution-artifact.md). Диспетчеризация общего запроса не считается готовым execution artifact.

## Назначение и границы

Telegram production worker и отдельный dispatch CLI используют общий Firestore factory из `packages/education-runtime/firestore.mjs` и `@google-cloud/firestore`, присутствующий в `dependencies`. Их транзитивные runtime import graphs не должны ссылаться на `firebase-admin`, который остаётся dev-only для совместимости прежних операторских CLI. Регрессионная проверка валидирует production dependency closure обоих entry points.

Прямое решение пользователя19.10 расширяет прежнюю границу Telegram: источник наблюдает Mesh и пользовательские действия Firebase, а watcher детерминированно собирает полный execution artifact до dispatch. EducationSync исполняет только проверенные задачи артефакта; свежий артефакт не запускает routine discovery. Обнаружение, классификация и уведомление остаются детерминированными; LLM не стоит между источником и Telegram. Диспетчер не копирует загрузчик МЭШ, Firebase публикацию или педагогические правила. Выполняющий чат использует `$education-sync` и штатный operator CLI, общий registry/session/credentials/телеметрию.

Общий workflow обслуживает все подключённые семьи. Конкретный существующий чат задаётся конфигурацией маршрута исполнения; это не список разрешённых семей или детей. Новый чат самопроизвольно не создаётся. Командный текст формируется из доверенного шаблона и ID запроса; текст ДЗ, имена и credentials в него не подставляются.

## События и устойчивость

Триггер — принятый actionable event из единой `educationEvents` очереди с подтверждённым owner и стабильным event ID. МЭШ delta публикуется в неё после успешного HTTP snapshot; клиентские help, quiz, upload и поддержанные material actions поступают напрямую или через временный compatibility reconciler. `technical.probe`, parent guidance/decision, review receipts и shadow не запускают workflow. Новый Mesh delta уже существующей baseline пригоден независимо от исторического имени origin bootstrap/live.

Dispatcher хранит Mesh trigger refs и typed action refs в одном generation-fenced request. Action task сохраняет event ID, event type, exact sourceRef и immutable artifact reference; материал может попасть в `ingest-material` только из точного источника со статусом `needs-identification`. Типы маршрутизации фиксированы: help → triage-help, quiz followup → generate-followup, quiz submission → review-quiz, upload confirmation → review-work, material ready → ingest-material. Неподдержанный или неразрешимый action visibly blocks. Окно20секунд собирает близкие события; новые события во время выполнения создают следующее поколение.

Состояния различают pending, sending, queued, uncertain, running, blocked и completed. Ошибка/потеря ответа CLI не доказывает отсутствие отправки. Повтор использует тот же request ID до его разрешения; выполняющая сторона атомарно получает claim, поэтому повтор сообщения не разрешает второй активный запуск. Все переходы проверяют request/state/claim; поздний queue acknowledgement не может перезаписать уже running/completed. Новые generation остаются pending после завершения прежней.

Успешная регистрация нового события возвращает локальному worker `nextDueAt` и будит dispatcher; ожидание заканчивается на максимуме debounce/retry сроков для actionable pending state. Отложенное состояние queued/running/blocked не получает таймер повторного dispatch. Внешнее завершение claim/workflow обнаруживается idle polling с базовым максимумом60 секунд и jitter до20% (до72 секунд); durable state позволяет восстановиться после перезапуска.

## Запуск и подтверждение

Транспорт — официальный `codex queue --thread UUID --message TEXT` с абсолютным путём CLI, без shell. Его exit0 означает принятие сообщения очередью, **не завершение синхронизации**. Ограничены время и размер stdout/stderr; исходные выводы CLI не пишутся в публичный журнал. Тайм-аут уничтожает дочерний процесс, учитывается неоднозначность доставки.

Сообщение требует сначала `claim --request ID`. Только ответ claimed разрешает полный workflow; running/completed/stale/иная ошибка останавливают повтор. Секрет claim находится в закрытом0600 файле вне Git и argv; операторский stdout содержит только путь. Между длительными стадиями вызывается heartbeat. После фактического успеха выполняется complete с тем же request и claim-file; при временной ошибке — fail с честным результатом. Пользователь19.10 прямо разрешил постоянную стандартную синхронизацию подтверждённых материалов МЭШ и их размещение в настроенном каталоге своего Яндекс.Диска с ссылкой для Education. Для каждого очередного такого вложения новое подтверждение не запрашивается; это не разрешает произвольные внешние назначения или отмену owner/hash/privacy проверок.

Если выполнение действительно остановлено внешней системой контроля действий, требуется решение вне принятого scope либо источник недоступен, используется block с конечным reasonCode permission_required, source_unavailable или manual_review_required. Blocked сохраняет новые поколения событий; Telegram продолжает доставку независимо. Для точного Mesh-only блока `source_unavailable` разрешены два узких пути: новый дедуплицированный Mesh-сигнал автоматически возобновляет тот же request, либо операторский resume продвигает frozen Mesh watermark через все уже накопленные Mesh-поколения. Оба требуют `sendingKinds: ['mesh']`, только Mesh в pendingKinds и отсутствия action-generation metadata; это обеспечивает один повторный полный Mesh sync. Неизвестная/устаревшая классификация, work/action, смешанный batch, `permission_required` и `manual_review_required` остаются заблокированы до явного операторского решения. Новое событие само по себе не доказывает доступность источника: повторное выполнение может снова завершиться block. Истечение workflow lease допускает восстановление и обновляет fencing claim; старое подтверждение больше не действует.

Доставка уведомления не зависит от скорости Codex. Отдельный dispatcher loop и deadline не задерживают outbox, Telegram polling и source observation. Физический Mac и приложение/учётная запись Codex должны быть доступны; это не облачная гарантия работы во сне или при выключенном хосте.

## Конфигурация и эксплуатация

Opt-in задаёт `EDUCATION_SYNC_CODEX_PATH` (абсолютный исполняемый CLI), `EDUCATION_SYNC_THREAD_ID` (существующий UUID), `EDUCATION_SYNC_PROJECT_ROOT` (актуальный основной checkout Education с операторским CLI). Допустим опциональный `EDUCATION_SYNC_REMOTE` с локальным unix endpoint; отсутствие remote использует стандартный transport CLI. Частичная/неверная конфигурация отклоняется. Installer проверяет пути и переносит настройки в постоянный LaunchAgent; claim workflow работает из основного checkout, не из сокращённого worker release.

Операторские команды `node scripts/education-sync-dispatch.mjs status|claim|heartbeat|complete|fail|block|resume` показывают различимые стадии; credential token не выводится. `events --since ISO` выдаёт ограниченный список последних opaque event IDs без payload. `enqueue-event --event-id HASH` адресно читает ledger, проверяет допустимый Mesh или подтверждённый Firestore work type и текущего зарегистрированного владельца. Work дедуплицируется по хешированным scope/work identity/type, чтобы метаданные не запускали повторную работу. Это не создание фиктивной оценки или ДЗ.

Claim freezes the exact lower/upper action generation range. The existing EducationSync exporter reads these exact jobs by request and opaque page cursor; it does not scan a global inbox. Claim completion is rejected while any frozen action job is not `done`. Request output exposes counts and manifest path only; source payload/artifacts stay private. Mesh snapshot execution remains on its existing full `$education-sync` path where no typed action artifact applies.

Это не заявляет выпуск полного action-to-artifact workflow: локальная реализация и тесты не подтверждают deployed producer coverage, artifact freshness rollout или live completion для каждой action family.

Поэтому реализация диспетчера отмечена как `partial` относительно принятого контракта: приведённые ниже live readback receipts остаются историческими подтверждениями прежнего dispatch/workflow, но не подтверждают наличие готового execution artifact или freshness validator.

## Проверки и статус выпуска

Read-only `events --since ISO` выдаёт только ограниченный список IDs/типов/времён для подтверждённых текущих владельцев. Firestore latency starts at source action time; it no longer measures discovery-listener delay because queue events arrive through the shared ingress. Школьная дата МЭШ не используется как метрика транспорта; отсутствующее/некорректное время не подменяется нулевой задержкой.

Обязательны сетевые заглушки и регрессии: тихий bootstrap/technical probe, повтор event ID, несколько событий за окно, новое событие во время running, потеря queue ack, быстрый claim до queue ack, late ack после complete, падение/повтор claim, stale token, зависший/неубиваемый CLI, oversized output, отсутствие transport/config и отсутствие горячего polling цикла. Runtime startup/source/delivery deadlines проверяются отдельно, включая реальное завершение дочернего процесса до поздней записи.

Живой выпуск требует три отдельных доказательства: natural Mesh ledger → точный outbox/digest receipt; CLI → ответ **того же** существующего чата; durable dispatch request → claimed/running → фактический результат workflow → complete либо явная блокировка. Демонстрационная technical.probe не заменяет первое доказательство. До получения всей цепочки implementation остаётся partial; локально проходящие тесты не объявляются выпущенной возможностью.

Live readback19.10: main3a7ac5b/worker40e370396896d1ce33e2085b,39файлов совпали;5naturalMesh events доставлены одной сводкой. Постоянный worker сам поставил один запрос generation5 в существующий EducationSync: queued→claimed/running и heartbeat подтверждены. Workflow собрал42дня и опубликовал три новые оценки с readback; перенос конкретного teacher attachment на пользовательский Диск отклонён auto-review, запрошено точное разрешение. Пользователь затем прямо подтвердил этот конкретный перенос и постоянную стандартную синхронизацию; разрешение передано исполняющему чату. Полное завершение подтверждается отдельным durable acknowledgement, а не этим разрешением. Этот реальный сценарий потребовал отдельного blocked/explicit-resume состояния вместо бесконечных минутных повторов.


Итоговый readback19.10: после main75b425c установлен worker34b3a4c68e7bf9b4556e1429;39файлов release совпадают с исходниками. Все93области успешно прочитаны, checkpointFresh93, неизвестных/просроченных0. Пять natural events покрыты одной уникальной Telegram receipt; pending/retry0. Автоматически созданный запрос44320156-3b17-47e7-8498-846d469d282d прошёл claim/heartbeat и фактический полный цикл42дней. Workflow самостоятельно записал completed19.10 в11:33:53UTC; итоговые очереди0/0/0. Разрешённый оригинал учителя опубликован и перечитан. Обнаруженный пропуск inbox уведомлений после сверки оценок восстановлен [штатной адресной командой](../../decisions/grade-notice-recovery-2026-10-19.md):6документов для3оценок, повтор created0/verifiedtrue. Эти факты завершают требуемую живую цепочку; доступность Mac/Codex остаётся эксплуатационным условием.
