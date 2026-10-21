---
id: decisions.queue-artifact-resolution-2026-10-20
status: reference
implementation: not-applicable
created: 2026-10-20
updated: 2026-10-20
consumers:
  - "Education sync operator"
code: []
parent: module.synchronization.global-sync
uses: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Разграничение форматов задач очереди

## Основание
Прямой запрос 20.10 на полную синхронизацию ДЗ и присланных решений. Начальный discover воспроизвёл падение verifiedResolution с undefined в запросе даты: event-action использует artifactPath вместо legacy source.dayDate/id.

## Было → стало
В scripts/sync-queue.mjs артефактные задачи больше не сверяются через legacy-координаты и не закрываются автоматически. Новый list --id читает одну точную задачу и её артефакт без изменения состояния или свежести. Решения и finish остаются отдельными проверенными действиями.

## Действия и роли
Только закрытый операторский CLI. Пользовательские экраны, доступы, попытки и решения не меняются. Ранее введённый materialRequest сохраняется. Адресное чтение ограничено operatorSyncJobs/ID и связанным проверенным путём operatorSyncTaskArtifacts/ID.

## Проверки
scripts/sync-queue-resolution.test.mjs: три вида event jobs остаются открытыми без legacy-запроса. Повторный полный discover прошёл и вернул complete inbox. Адресные list прочитали реальные фото/тесты; живое применение результата выполняется штатными submissions/quiz с readback, а не этим чтением.

## Согласование
Исправление необходимо для выполнения прямо запрошенной полной синхронизации; интерфейс и обязательный объём учебной работы не переосмысляются. PWA и runtime не переустанавливаются.
