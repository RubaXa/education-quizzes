---
id: decision.sync-claim-liveness
status: accepted
implementation: implemented
created: 2026-11-19
updated: 2026-11-19
parent: service.telegram-bot.education-sync-dispatch
uses:
  - module.synchronization.firestore-read-paths
consumers:
  - Education operator
  - Telegram worker
code:
  - scripts/education-sync-dispatch.mjs
  - sync/dispatch-workspace.mjs
  - packages/telegram-notifications/application/education-sync-dispatcher.mjs
  - packages/telegram-notifications/adapters/runtime.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Собственный claim и наблюдение прогресса

## Основание

19.11 пользователь потребовал продолжить сохранённый claim без дубликата и
устранить остановку на собственном running. Отсутствие реакции пять минут должно
быть видно в локальном состоянии; новые расписания не нужны.

## Было → стало

Потерянный ответ claimed приводил к повторному claim, ответу running и остановке.
Теперь scripts/education-sync-dispatch.mjs сохраняет ownerThreadId и повторно
использует файл только при совпадении чата и серверных request/hash/lease.
Чужой и устаревший токены не переиспользуются. Heartbeat обновляет progress,
сохраняя фазу/поколение.

sync/dispatch-workspace.mjs различает реальную реакцию и часы наблюдателя.
packages/telegram-notifications/application/education-sync-dispatcher.mjs
передаёт уже прочитанное состояние после транзакции локальному наблюдателю.
packages/telegram-notifications/adapters/runtime.mjs пишет health на существующем
проходе worker и одну диагностическую ошибку при переходе в stalled после пяти
минут молчания. Наблюдатель не продлевает lease и не выдаёт тик за выполненную работу.

## Действия и роли

Нет изменений учебных карточек, фото, попыток, оценок, прав или хранения семьи.
Наблюдение не создаёт новое сообщение, расписание или второго исполнителя.
Порог обнаружения зависания не является разрешением перехватить активную запись.
Явное восстановление использует прежнее полномочие; серверное fencing сохранено.

## Проверки

Регрессии scripts/education-sync-dispatch.test.mjs: потерянный claimed, тот же
файл/токен, чужой чат и токен, пять минут молчания, тики без ложной реакции,0600.
packages/telegram-notifications/application/education-sync-dispatch-store.test.mjs:
наблюдение занятого drainer без новых документов/изменения серверного claim.
scripts/telegram-runtime-dependencies.test.mjs проверяет production closure.
Обязательны общий npm run check, граф спецификаций и установленный worker/readback.

## Согласование

Прямой запрос пользователя19.11.2026: «продолжи с тем же claim, без дубликата»,
«если нет времени там5минут, значит он завис» и контроль существующим процессом.
Это согласование исправления процесса, не основание автоматически зачесть учебную работу.
