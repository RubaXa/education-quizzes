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

Прямое решение пользователя19.10 расширяет прежнюю границу Telegram: источник наблюдает Mesh и пользовательские действия Firebase, а watcher детерминированно собирает полный execution artifact до dispatch. EducationSync исполняет только проверенные задачи артефакта; свежий артефакт не запускает routine discovery. Обнаружение, классификация и уведомление остаются детерминированными; LLM не стоит между источником и Telegram. Диспетчер не копирует загрузчик МЭШ, Firebase публикацию или педагогические правила. Выполняющий чат использует `$education-sync` и штатный operator CLI, общий registry/session/credentials/телеметрию.

Общий workflow обслуживает все подключённые семьи. Конкретный существующий чат задаётся конфигурацией маршрута исполнения; это не список разрешённых семей или детей. Новый чат самопроизвольно не создаётся. Командный текст формируется из доверенного шаблона и ID запроса; текст ДЗ, имена и credentials в него не подставляются.

## События и устойчивость

Триггер — принятое natural Mesh событие с подтверждённым owner и стабильным event ID. Первое тихое наблюдение новой области не становится изменением; technical.probe и shadow не запускают workflow. Новый delta уже существующей baseline пригоден независимо от исторического имени origin bootstrap/live.

После idempotent приёма notification event и до продвижения source checkpoint диспетчер устойчиво регистрирует event ID. Повтор pending после аварии повторяет эту регистрацию безопасно. Firestore хранит адресную дедупликацию событий и одну агрегированную очередь запуска; окно20секунд собирает близкие изменения. Новое событие во время запуска увеличивает generation и не теряется при завершении текущего запроса. Число семей не ограничено; coalescing не делает семью владельцем глобального sync.

Состояния различают pending, sending, queued, uncertain, running, blocked и completed. Ошибка/потеря ответа CLI не доказывает отсутствие отправки. Повтор использует тот же request ID до его разрешения; выполняющая сторона атомарно получает claim, поэтому повтор сообщения не разрешает второй активный запуск. Все переходы проверяют request/state/claim; поздний queue acknowledgement не может перезаписать уже running/completed. Новые generation остаются pending после завершения прежней.

Успешная регистрация нового события возвращает локальному worker `nextDueAt` и будит dispatcher; ожидание заканчивается на максимуме debounce/retry сроков для actionable pending state. Отложенное состояние queued/running/blocked не получает таймер повторного dispatch. Внешнее завершение claim/workflow обнаруживается idle polling с базовым максимумом60 секунд и jitter до20% (до72 секунд); durable state позволяет восстановиться после перезапуска.

## Запуск и подтверждение

Транспорт — официальный `codex queue --thread UUID --message TEXT` с абсолютным путём CLI, без shell. Его exit0 означает принятие сообщения очередью, **не завершение синхронизации**. Ограничены время и размер stdout/stderr; исходные выводы CLI не пишутся в публичный журнал. Тайм-аут уничтожает дочерний процесс, учитывается неоднозначность доставки.

Сообщение требует сначала `claim --request ID`. Только ответ claimed разрешает полный workflow; running/completed/stale/иная ошибка останавливают повтор. Секрет claim находится в закрытом0600 файле вне Git и argv; операторский stdout содержит только путь. Между длительными стадиями вызывается heartbeat. После фактического успеха выполняется complete с тем же request и claim-file; при временной ошибке — fail с честным результатом. Пользователь19.10 прямо разрешил постоянную стандартную синхронизацию подтверждённых материалов МЭШ и их размещение в настроенном каталоге своего Яндекс.Диска с ссылкой для Education. Для каждого очередного такого вложения новое подтверждение не запрашивается; это не разрешает произвольные внешние назначения или отмену owner/hash/privacy проверок.

Если выполнение действительно остановлено внешней системой контроля действий, требуется решение вне принятого scope либо источник недоступен, используется block с конечным reasonCode permission_required, source_unavailable или manual_review_required. Blocked не повторяет Codex сообщения и сохраняет новые поколения событий; Telegram продолжает доставку независимо. Только явный операторский resume того же request разрешает повтор; отсутствие ответа пользователя не является разрешением. Истечение workflow lease допускает восстановление и обновляет fencing claim; старое подтверждение больше не действует.

Доставка уведомления не зависит от скорости Codex. Отдельный dispatcher loop и deadline не задерживают outbox, Telegram polling и source observation. Физический Mac и приложение/учётная запись Codex должны быть доступны; это не облачная гарантия работы во сне или при выключенном хосте.

## Конфигурация и эксплуатация

Opt-in задаёт `EDUCATION_SYNC_CODEX_PATH` (абсолютный исполняемый CLI), `EDUCATION_SYNC_THREAD_ID` (существующий UUID), `EDUCATION_SYNC_PROJECT_ROOT` (актуальный основной checkout Education с операторским CLI). Допустим опциональный `EDUCATION_SYNC_REMOTE` с локальным unix endpoint; отсутствие remote использует стандартный transport CLI. Частичная/неверная конфигурация отклоняется. Installer проверяет пути и переносит настройки в постоянный LaunchAgent; claim workflow работает из основного checkout, не из сокращённого worker release.

Операторские команды `node scripts/education-sync-dispatch.mjs status|claim|heartbeat|complete|fail|block|resume` показывают различимые стадии; credential token не выводится. `events --since ISO` выдаёт ограниченный список последних opaque event IDs без payload. `enqueue-event --event-id HASH` адресно читает ledger, проверяет допустимый Mesh или подтверждённый Firestore work type и текущего зарегистрированного владельца. Work дедуплицируется по хешированным scope/work identity/type, чтобы метаданные не запускали повторную работу. Это не создание фиктивной оценки или ДЗ.

В нынешней реализации для Firestore `upload.confirmed` и `quiz.submitted` запускается только узкий inbox review (`npm run sync:inbox`). `quiz.started`, `review.changed`, `technical.probe` и shadow mode запрос не создают. Mesh и смешанные пачки сохраняют полный текущий `$education-sync` путь. Классификация конечной пачки (`mesh`, `work`) фиксируется при claim; новые события накапливаются отдельно для следующего поколения. `status` показывает эти ограниченные виды без source payload. В legacy state без kind arrays активное незавершённое поколение консервативно считается Mesh, чтобы не потерять ранее принятое Mesh work; завершённые state начинают новый batch чисто. Это текущее поведение не удовлетворяет контракту готового артефакта и его проверки свежести.

Этот узкий триггер не реализует все адресные change plans для экономии полного Mesh workflow; Mesh и смешанный запуск остаются существующим полным безопасным сценарием.

Поэтому реализация диспетчера отмечена как `partial` относительно принятого контракта: приведённые ниже live readback receipts остаются историческими подтверждениями прежнего dispatch/workflow, но не подтверждают наличие готового execution artifact или freshness validator.

## Проверки и статус выпуска

Обязательны сетевые заглушки и регрессии: тихий bootstrap/technical probe, повтор event ID, несколько событий за окно, новое событие во время running, потеря queue ack, быстрый claim до queue ack, late ack после complete, падение/повтор claim, stale token, зависший/неубиваемый CLI, oversized output, отсутствие transport/config и отсутствие горячего polling цикла. Runtime startup/source/delivery deadlines проверяются отдельно, включая реальное завершение дочернего процесса до поздней записи.

Живой выпуск требует три отдельных доказательства: natural Mesh ledger → точный outbox/digest receipt; CLI → ответ **того же** существующего чата; durable dispatch request → claimed/running → фактический результат workflow → complete либо явная блокировка. Демонстрационная technical.probe не заменяет первое доказательство. До получения всей цепочки implementation остаётся partial; локально проходящие тесты не объявляются выпущенной возможностью.

Live readback19.10: main3a7ac5b/worker40e370396896d1ce33e2085b,39файлов совпали;5naturalMesh events доставлены одной сводкой. Постоянный worker сам поставил один запрос generation5 в существующий EducationSync: queued→claimed/running и heartbeat подтверждены. Workflow собрал42дня и опубликовал три новые оценки с readback; перенос конкретного teacher attachment на пользовательский Диск отклонён auto-review, запрошено точное разрешение. Пользователь затем прямо подтвердил этот конкретный перенос и постоянную стандартную синхронизацию; разрешение передано исполняющему чату. Полное завершение подтверждается отдельным durable acknowledgement, а не этим разрешением. Этот реальный сценарий потребовал отдельного blocked/explicit-resume состояния вместо бесконечных минутных повторов.


Итоговый readback19.10: после main75b425c установлен worker34b3a4c68e7bf9b4556e1429;39файлов release совпадают с исходниками. Все93области успешно прочитаны, checkpointFresh93, неизвестных/просроченных0. Пять natural events покрыты одной уникальной Telegram receipt; pending/retry0. Автоматически созданный запрос44320156-3b17-47e7-8498-846d469d282d прошёл claim/heartbeat и фактический полный цикл42дней. Workflow самостоятельно записал completed19.10 в11:33:53UTC; итоговые очереди0/0/0. Разрешённый оригинал учителя опубликован и перечитан. Обнаруженный пропуск inbox уведомлений после сверки оценок восстановлен [штатной адресной командой](../../decisions/grade-notice-recovery-2026-10-19.md):6документов для3оценок, повтор created0/verifiedtrue. Эти факты завершают требуемую живую цепочку; доступность Mac/Codex остаётся эксплуатационным условием.
