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

## Назначение и границы

Прямое решение пользователя19.10 расширяет прежнюю границу Telegram: подтверждённое изменение МЭШ запрашивает полный цикл существующего EducationSync. Обнаружение, классификация и уведомление остаются детерминированными; LLM не стоит между источником и Telegram. Диспетчер не копирует загрузчик МЭШ, Firebase публикацию или педагогические правила. Выполняющий чат использует `$education-sync` и штатный operator CLI, общий registry/session/credentials/телеметрию.

Общий workflow обслуживает все подключённые семьи. Конкретный существующий чат задаётся конфигурацией маршрута исполнения; это не список разрешённых семей или детей. Новый чат самопроизвольно не создаётся. Командный текст формируется из доверенного шаблона и ID запроса; текст ДЗ, имена и credentials в него не подставляются.

## События и устойчивость

Триггер — принятое natural Mesh событие с подтверждённым owner и стабильным event ID. Первое тихое наблюдение новой области не становится изменением; technical.probe и shadow не запускают workflow. Новый delta уже существующей baseline пригоден независимо от исторического имени origin bootstrap/live.

После idempotent приёма notification event и до продвижения source checkpoint диспетчер устойчиво регистрирует event ID. Повтор pending после аварии повторяет эту регистрацию безопасно. Firestore хранит адресную дедупликацию событий и одну агрегированную очередь запуска; окно20секунд собирает близкие изменения. Новое событие во время запуска увеличивает generation и не теряется при завершении текущего запроса. Число семей не ограничено; coalescing не делает семью владельцем глобального sync.

Состояния различают pending, sending, queued, uncertain, running и completed. Ошибка/потеря ответа CLI не доказывает отсутствие отправки. Повтор использует тот же request ID до его разрешения; выполняющая сторона атомарно получает claim, поэтому повтор сообщения не разрешает второй активный запуск. Все переходы проверяют request/state/claim; поздний queue acknowledgement не может перезаписать уже running/completed. Новые generation остаются pending после завершения прежней.

## Запуск и подтверждение

Транспорт — официальный `codex queue --thread UUID --message TEXT` с абсолютным путём CLI, без shell. Его exit0 означает принятие сообщения очередью, **не завершение синхронизации**. Ограничены время и размер stdout/stderr; исходные выводы CLI не пишутся в публичный журнал. Тайм-аут уничтожает дочерний процесс, учитывается неоднозначность доставки.

Сообщение требует сначала `claim --request ID`. Только ответ claimed разрешает полный workflow; running/completed/stale/иная ошибка останавливают повтор. Секрет claim находится в закрытом0600 файле вне Git и argv; операторский stdout содержит только путь. Между длительными стадиями вызывается heartbeat. После фактического успеха выполняется complete с тем же request и claim-file; при блокировке/ошибке — fail с честным результатом. Истечение workflow lease допускает восстановление и обновляет fencing claim; старое подтверждение больше не действует.

Доставка уведомления не зависит от скорости Codex. Отдельный dispatcher loop и deadline не задерживают outbox, Telegram polling и source observation. Физический Mac и приложение/учётная запись Codex должны быть доступны; это не облачная гарантия работы во сне или при выключенном хосте.

## Конфигурация и эксплуатация

Opt-in задаёт `EDUCATION_SYNC_CODEX_PATH` (абсолютный исполняемый CLI), `EDUCATION_SYNC_THREAD_ID` (существующий UUID), `EDUCATION_SYNC_PROJECT_ROOT` (актуальный основной checkout Education с операторским CLI). Допустим опциональный `EDUCATION_SYNC_REMOTE` с локальным unix endpoint; отсутствие remote использует стандартный transport CLI. Частичная/неверная конфигурация отклоняется. Installer проверяет пути и переносит настройки в постоянный LaunchAgent; claim workflow работает из основного checkout, не из сокращённого worker release.

Операторские команды `node scripts/education-sync-dispatch.mjs status|claim|heartbeat|complete|fail` показывают различимые стадии; credential token не выводится. `enqueue-event --event-id HASH` предназначен для явного восстановления уже принятого естественного события: адресно читает ledger, проверяет Mesh type и текущего зарегистрированного владельца. Это не создание фиктивной оценки или ДЗ. Повтор события идемпотентен. Read-only [mesh-delivery-check](operations.md#проверка-реальных-изменений-мэш) даёт event IDs и фактические квитанции без повторной отправки.

## Проверки и статус выпуска

Обязательны сетевые заглушки и регрессии: тихий bootstrap/technical probe, повтор event ID, несколько событий за окно, новое событие во время running, потеря queue ack, быстрый claim до queue ack, late ack после complete, падение/повтор claim, stale token, зависший/неубиваемый CLI, oversized output, отсутствие transport/config и отсутствие горячего polling цикла. Runtime startup/source/delivery deadlines проверяются отдельно, включая реальное завершение дочернего процесса до поздней записи.

Живой выпуск требует три отдельных доказательства: natural Mesh ledger → точный outbox/digest receipt; CLI → ответ **того же** существующего чата; durable dispatch request → claimed/running → фактический результат workflow → complete либо явная блокировка. Демонстрационная technical.probe не заменяет первое доказательство. До получения всей цепочки implementation остаётся partial; локально проходящие тесты не объявляются выпущенной возможностью.
