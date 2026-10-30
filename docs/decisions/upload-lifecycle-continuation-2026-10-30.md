---
id: decision.upload-lifecycle-continuation-2026-10-30
status: accepted
implementation: implemented
created: 2026-10-30
updated: 2026-10-30
parent: module.synchronization.event-queue
uses:
  - module.synchronization.execution-artifact
  - module.materials.material-clarification
consumers:
  - upload broker
  - dispatcher
  - EducationSync executor
code:
  - sync/upload-lifecycle.mjs
  - packages/education-runtime/upload-broker.mjs
  - packages/telegram-notifications/application/education-sync-dispatcher.mjs
  - sync/event-task-artifact.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Жизненный цикл фото и адресное продолжение

## Основание

Прямой запрос родителя30.10: удалённые фото должны автоматически уходить из
очереди, а загрузка запрошенной страницы должна возобновлять работу без ручного
запуска.

## Было → стало

Было: оригинал удалялся, но review job сохранял blocked; запрос страницы
попадал в source-material, но старые ожидающие этапы не получали связи с ним.
Стало: транзакционная отмена точного upload job, защита от позднего confirmed;
зависимые этапы с requestId/fingerprint захватываются в immutable artifact и
возобновляются атомарно с новой dispatch generation. Повтор не дублирует работу,
смена владельца, запроса или ревизии не даёт возобновить чужой/устаревший этап.

Затронуты sync/upload-lifecycle.mjs, packages/education-runtime/upload-broker.mjs,
packages/telegram-notifications/application/education-sync-dispatcher.mjs,
sync/event-task-artifact.mjs, sync/task-route.mjs, sync/job-queue.mjs и
packages/telegram-notifications/adapters/source-firestore.mjs.

## Действия и роли

[Контракт и пределы](../modules/synchronization/event-queue.md#upload-lifecycle).
Разбор источника и педагогическое решение выполняет существующий EducationSync
executor; полученная страница не оценивается как выполненное ДЗ. В том же
поручении он закрывает запрос по доказательствам и продолжает назначение либо
публикует один уточняющий вопрос, сохранив адресное ожидание.

Обновление сохраняет уже установленный контракт домашней практики, границу
доверия к вложениям и различие done-чекбокса/разбора. Эти изменения ранее работали
в локальном runtime, но ещё не были включены в main; их сохранение необходимо,
чтобы установка нового конвейера не возвращала старый hold или ложный review.

## Проверки

sync/upload-lifecycle.test.mjs (broker, deletion/replay, late confirmation,
request/revision guards, automatic dispatch, independent Mesh block), существующие
upload-broker, task-route, event-task-artifact, action-store и source-pipeline.
Полная проверка обязательна перед интеграцией; установленный worker и readiness
проверяются отдельно. Этот документ не доказывает получение будущего фото ребёнка.


## Согласование

Прямой запрос родителя30.10 на исправление и рабочую автоматическую обработку.
Установка worker и интеграция выполняются в рамках установленного порядка выпуска;
учебные оценки и полученные снимки без источника не создаются.

Runtime использует Timestamp из production @google-cloud/firestore; добавленная
связь очереди не втягивает dev-only firebase-admin в установленный worker.
