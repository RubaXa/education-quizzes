---
id: decision.sync-permission-scope-2026-11-08
status: accepted
implementation: implemented
created: 2026-11-08
updated: 2026-11-08
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
# Разрешение относится к конкретной операции

## Основание
Родитель08.11 потребовал закрывать проверенные внутренние задачи без участия
родителя и устранить зависание общей синхронизации на старом permission_required.
Локальный ack-day существовал вне выпущенного main; dispatcher принимал голую
причину и оставлял активные диагностические поля после успешного восстановления.

## Было → стало
Внутренняя reconcile-day закрывается из queued/processing и устаревшего
blocked permission_required только после свежего аудита публикации обеих ролей,
совпадения run/owner/date/fingerprint и транзакционной повторной проверки.
Source/manual review блокировки остаются препятствием; гонка причины тоже останавливает запись.
Факт снятой permission-блокировки сохраняется в resolvedBlock.

Глобальный permission_required требует operation из source-access, material-sync,
data-publication, action-processing и denialRef вида tool-policy:CALL_ID.
Это ссылка на реальный явный отказ внешнего инструмента, а не разрешение обойти его.
Без доказательства возвращается permission_evidence_required без потери claim;
для reconcile-day/ack-day/next/complete/per-file-confirmation — standard_operation_authorized.
CLI возвращает ошибку, claim и локальный пакет сохраняются. Source/manual причины
остаются штатными. Ограничение Git/PWA выпуска само по себе не блокирует учебный пул.
После успешного resume/next/complete активные blockedReasonCode/blockedAt/
permissionBlock/lastErrorCode очищаются, история lastResolvedBlock сохраняется.
Ни одна реальная блокировка не снимается по возрасту.

## Действия и роли
scripts/sync-project.mjs предоставляет адресный ack-day через sync/reconciliation-ack.mjs.
scripts/education-sync-dispatch.mjs передаёт типизированное основание block и
resume-here запускает ту же сессию без нового сообщения. Серверная authority/lease
в packages/telegram-notifications/application/education-sync-dispatcher.mjs исключает
новое пробуждение при активной общей или action-сессии; новые события остаются в пуле.
При завершении action lane не очищается независимая source-блокировка общего lane.
Старый blocked permission_required восстанавливает оператор командой resume-here;
новая очередь не обходит реальные запреты автоматически.

## Проверки
RED: три воспроизведения — голая permission-метка, оставшиеся диагностические поля,
невозможность закрыть проверенную внутреннюю permission-задачу. GREEN: те же проверки,
идемпотентность, гонка причины, сохранение явного внешнего запрета, fencing claim и
исключение параллельного пробуждения. Полная проверка и выпуск подтверждаются отдельно.

## Согласование
Прямое поручение родителя08.11.2026: «Исправь причину, чтобы синхронизация больше
не зависала на старом „требуется разрешение“. … проверенные внутренние задачи
должны закрываться без моего участия». Новое разрешение на внутреннее закрытие не требуется.
