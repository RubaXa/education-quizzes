---
id: decision.worker-release-retention-2026-11-18
status: accepted
implementation: implemented
created: 2026-11-18
updated: 2026-11-18
parent: service.telegram-bot.operations
uses:
  - service.telegram-bot.operations
  - shared.toolchain
consumers:
  - operator
  - release maintainer
code:
  - packages/telegram-notifications/operations/release-retention.mjs
  - packages/telegram-notifications/operations/launch-agent.mjs
  - scripts/telegram-runtime.mjs
  - operator/run-report.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Ограниченные и компактные релизы worker

## Основание

Родитель18.11 поручил закрепить существующую автоочистку в main и убрать лишние
зависимости worker, сохранив активную версию, проверенный резерв и учебные данные.
Очистка была только локальной правкой установленного оператора; исходный main её
терял. Корневой production manifest устанавливал также зависимости интерфейса.

## Было → стало

Переносим существующий протокол retention в репозиторий. После успешного readiness
и полного подтверждённого sync используется один алгоритм: активный, проверенный
резерв и живые процессы защищены; остальные допустимые release удаляются с журналом.
Неудачная установка не запускает очистку и восстанавливает прежний worker.
Неудачная сертификация резерва запрещает удаление также в следующем sync;
loaded без running не считается прежним работающим релизом.

Вместо manifest всего приложения используется отдельный runtime manifest и lock
в packages/telegram-notifications/runtime. Версии необходимых прямых библиотек
сохранены; пакет МЭШ закреплён на том же commit. Корневые зависимости сайта и его
prepare hook не входят в сборку. Старый reserve с корневым manifest по-прежнему
проверяется по его исходному хэшу, поэтому миграция не лишает возможности отката.

## Действия и роли

packages/telegram-notifications/operations/release-retention.mjs ограничивает
удаление, блокировку и журнал. packages/telegram-notifications/operations/launch-agent.mjs
собирает runtime, проверяет readiness/rollback и запускает обслуживание.
scripts/telegram-runtime.mjs предоставляет dry-run/apply cleanup-releases.
operator/run-report.mjs подключает обслуживание к успешному полному завершению;
квитанция очереди не подменяет полноту фаз. Интерфейс, роли, расписания и учебные
критерии не меняются. Новых Firestore чтений или удаления учебных записей нет.

## Проверки

Регрессии: сохранение active/backup/live, lock и гонка процессов, отказ health,
symlink/посторонние данные, учебные sentinel-файлы вне releases, dry-run и повтор.
Три установки проверяют ротацию и rollback при readiness failure. Проверки полного
sync исключают partial/action/blocked/fail и незавершённую очередь. Проверка runtime
сопоставляет реальные импорты с manifest/lock и запрещает зависимости интерфейса;
production assembly проверяется существующим constructor preflight.
Полный npm run check и штатные hooks обязательны перед интеграцией.

## Согласование

Прямой запрос18.11: закрепить автоочистку в main, убрать лишние зависимости worker,
проверить сохранение активного/резервного релизов и неприкосновенность учебных данных.
Стандартный выпуск проверенной итерации ранее разрешён; учебная синхронизация или
массовая очистка других каталогов в эту задачу не входят.
