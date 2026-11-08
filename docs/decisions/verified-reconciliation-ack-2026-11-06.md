---
id: decision.verified-reconciliation-ack-2026-11-06
status: accepted
implementation: implemented
created: 2026-11-06
updated: 2026-11-06
parent: module.synchronization.global-sync
uses:
  - service.telegram-bot.education-sync-dispatch
consumers:
  - operator
code:
  - sync/reconciliation-ack.mjs
  - scripts/sync-project.mjs
  - scripts/education-sync-dispatch.mjs
  - packages/telegram-notifications/application/education-sync-dispatcher.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Проверенные внутренние задачи без повторного разрешения

## Основание

Родитель06.11 прямо поручил закрывать проверенные внутренние задачи без его
разрешения, сохранять новые события в общем пуле без сообщений во время активной
обработки и завершить зависшую сверку09.11. Автоматическая проверка ошибочно
трактовала queued reconcile-day как незавершённое учебное действие, хотя complete
сам должен был подтвердить его после публикации и readback.

## Было → стало

sync/reconciliation-ack.mjs подтверждает одну дату и её точную ревизию после
свежего аудита публикаций обеих ролей. scripts/sync-project.mjs предоставляет
ack-day и использует ту же операцию при complete; изменение fingerprint/run/owner
между аудитом и записью останавливает подтверждение. Повтор безопасен.
Не закрываются фото, тесты, ожидания материалов или чужие запуски.

## Действия и роли

packages/telegram-notifications/application/education-sync-dispatcher.mjs
проверяет общую активную основную/action сессию до всех recovery-маршрутов.
При queued/live sending/live running нет нового transport claim: новые события
остаются pending и читаются следующим frozen batch того же агента. Истёкший
lease сохраняет прежний контролируемый путь восстановления.
scripts/education-sync-dispatch.mjs resume-here атомарно возобновляет конкретный
blocked request с новым токеном и lease, не оставляя pending-окна для нового
сообщения. Старый frozen диапазон сохраняется, новый пул не теряется.

## Проверки

reconciliation-ack.test.mjs: точная дата/revision, readback/idempotency,
отказ при pending publication, смене owner/run/fingerprint и блокировке материала.
education-sync-dispatch-store.test.mjs: события при активной action lane остаются
в pending, транспортного claim нет; resume-here не создаёт нового wake.
education-sync-dispatch.test.mjs: native resume-here пишет private0600 claim.
Существующие гонки next/event и frozen generation сохраняются.

## Согласование

Прямое текущее поручение разрешает эти действия и адресное закрытие09.11.
Никаких сообщений другим чатам или нового расписания. Рабочий runtime требуется
обновить штатной установкой, иначе изменение dispatcher останется только кодом.
