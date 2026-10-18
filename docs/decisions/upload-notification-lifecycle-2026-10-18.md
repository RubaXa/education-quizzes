---
id: decision.upload-notification-lifecycle-2026-10-18
status: accepted
implementation: not-applicable
created: 2026-10-18
updated: 2026-10-18
parent: service.telegram-bot.firestore
uses:
  - service.telegram-bot.delivery
  - service.telegram-bot.ports-and-events
  - module.notifications.events
consumers:
  - Education team
  - Telegram implementer
  - UI gate
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Подтверждённая загрузка и контекст решения в Telegram

## Основание

Прямой запрос родителя18.10: ребёнок загрузил решение, семейного Telegram сообщения нет, неизвестно к какому заданию. Независимая Luna и root нашли расхождение source adapter со storage protocol: worker после проверки файла сохраняет `pending+storage.state=stored`, а Telegram принимал только `uploaded/reviewed`. Перечитывание после короткого `uploaded` закономерно видит стабильный `pending` и пустую проекцию. Штатный inbox подтвердил свежие сохранённые загрузки; реальные ID/пути/содержание работ остаются приватными.

## Было → стало

Подтверждённый storage pending входит в upload mapping, незавершённый transfer остаётся неподтверждённым. Сообщение дополняется точным безопасным task context из проверенной дневной страницы. Чистый resolver общий для inbox/Telegram, SDK хранения не импортируется в notification runtime. Уже известный файл не считается новой загрузкой из-за review status или обогащения полей; новая live загрузка получает обычные durable event/outbox/receipt. Начальная история и миграция неоднозначной bootstrap проекции сохраняют тихую baseline. Независимая Luna отдельно проверила случай старого live scope без baseline: он намеренно восстанавливает пропущенный факт независимо от возраста. Диагностическое окно не является фильтром доставки.

## Действия и роли

Luna реализует source mapping, shared task context, однократную upload семантику, renderer и официальный read-only upload-check с регрессиями. Root проверяет код и реальные источник/discovery/checkpoint/outbox, обновляет контракт/реестр чтений, выполняет gates, выпуск и receipt readback. В общей очереди live имеет приоритет перед bootstrap, но после восьми live dispatch выделяется слот ожидающему bootstrap, исключая его голодание. Длинные подписи ограничены безопасной длиной. Педагогическая проверка фото не выполняется и не подменяется уведомлением.

Затронутые runtime-файлы:

- `packages/education-runtime/task-context.mjs`
- `storage/inbox-notifications.mjs`
- `packages/telegram-notifications/adapters/source-firestore.mjs`
- `packages/telegram-notifications/adapters/source-coordinator.mjs`
- `packages/telegram-notifications/application/source-pipeline.mjs`
- `packages/telegram-notifications/domain/events.mjs`
- `packages/telegram-notifications/domain/renderer.mjs`
- `packages/telegram-notifications/operations/upload-check.mjs`
- `scripts/telegram-runtime.mjs`

## Проверки

Проверяются быстрый переход requested→uploaded→pending, pending без stored, повтор/restart, reviewed и контекстное обогащение без повторной отправки, тихая история bootstrap, live discovery, неверный owner/task, отсутствующая карточка, запрет original/URL/path/ID leakage, реальные safe diagnostics и доставка текущего факта. Приёмка — реальные уведомления о пропущенных загрузках с понятным названием задания и подтверждённой receipt через штатную цепочку. Факты приёмки18.10: до исправления у трёх свежих live uploads были пустые checkpoints, ноль ledger/outbox/receipts. Во время исправления пришли ещё две загрузки. Итоговый штатный `upload-check --since 2026-10-18T06:30:00Z`:79 upload scopes,74 bootstrap/5 live; все5 свежих подтверждённых файлов вошли в projection v2 baseline, ledgerPresent=5, outboxSent=5, sentReceipts=5, pending/retry/absent=0, unverified/pipelineRejected=0. Диагностика сама ничего не отправляет и не пишет: восстановление выполнено обычным worker. Telegram API receipt подтверждает отправку, а не прочтение пользователем.

Изолированный `npm run check`:761tests/152files; после включения параллельной итерации из main повторный полный check776tests/155files и production build прошли. spec/link/UI contract, read registry и lint прошли. Установлен постоянный release `327c01c8022f3bb0febbc769`;34файла runtime closure/package manifests совпали с проверенным checkout. LaunchAgent running, readiness readyForDelivery, оба outbox queries готовы. Отдельная Luna повторно просмотрела bounds/shared normalization/scheduler и не нашла блокирующей регрессии. Приватные CLI receipts сохранены локально, без переноса ID или содержимого работ в репозиторий.

## Согласование

Прямой запрос исправить отсутствие семейного уведомления и ранее данное разрешение на source→Telegram интеграцию/проверки/выпуск включают восстановление текущих подтверждённых уведомлений. Отправка адресуется существующей проверенной семейной связи, без ручного угадывания chat/user IDs. Семьи обнаруживаются автоматически без allowlist. Завершённый fix интегрируется в main и постоянный Mac runtime; временный checkout служит проверке отдельно от текущих посторонних UI правок.
