---
id: decision.sync-single-drainer-2026-11-05
status: accepted
implementation: partial
created: 2026-11-05
updated: 2026-11-05
parent: service.telegram-bot.education-sync-dispatch
uses:
  - module.synchronization.execution-artifact
consumers:
  - Education operator
  - Telegram worker
code:
  - packages/telegram-notifications/application/education-sync-dispatcher.mjs
  - scripts/education-sync-dispatch.mjs
  - sync/dispatch-workspace.mjs
  - sync/event-task-export.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Один исполнитель очереди Education

## Основание

Родитель показал накопившиеся одинаковые поручения и прямо согласовал серверную
очередь с локальными пакетами и прогрессом. Дефект воспроизведён: queued превращался
в uncertain через10минут ожидания, затем повторно отправлялся в чат. Кроме того,
complete освобождал lease даже при наличии следующего пакета.

## Было → стало

Подтверждённое queued больше не истекает по времени ожидания. Агент явно подтверждает
обработанное поколение командой next; проверка текущего пакета, захват следующего
и освобождение lease при пустой очереди выполняются атомарно. Frozen диапазон
не расширяется. Новый пакет перечитывается тем же агентом без сообщения в чат.
Старый complete остаётся совместимым. Новые пробуждения получают инструкцию drainer.

Затронуты `packages/telegram-notifications/application/education-sync-dispatcher.mjs`,
`scripts/education-sync-dispatch.mjs`, `sync/event-task-export.mjs` и
`sync/dispatch-workspace.mjs`. Последний хранит закрытый progress и удаляет только
папку подтверждённого поколения; оригиналы и история остаются.

## Действия и роли

Изменён только операторский маршрут. Семейные роли, карточки, фото и результаты
не мигрируют. Источник истины — Firestore; файл прогресса не разрешает операции.
Source block не мешает следующему независимому action пакету и не закрывается им.
Первое пробуждение и новые Mesh пакеты проходят полный42-дневный цикл; поступление
Firebase событий внутри активной сессии не требует повторной доставки поручения.

## Проверки

Тесты диспетчера воспроизводят долгое queued и подтверждают отсутствие повторной
отправки. Store тесты проверяют same-lease continuation, конкурентные next, stale
поколение, пустую очередь и запрет старого heartbeat. Action store проверяет
незавершённый job и сохранение source block. CLI тест проверяет права0600,
отсутствие токена в progress, сохранение следующего пакета и удаление claim только
после completed. Совместимые complete/fail/block сохраняют конечную фазу progress;
регрессии проверяют completed/blocked вместо оставшегося claimed.
Общие check и установка worker — отдельные обязательные этапы.

## Согласование

Прямое подтверждение родителя05.11.2026: переделать неадекватно работающую
синхронизацию по предложенному третьему варианту. Разрешение не является
подтверждением live выпуска; он проверяется после merge/install отдельно.
