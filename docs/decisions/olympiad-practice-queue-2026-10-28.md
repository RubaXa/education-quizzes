---
id: decision.olympiad-practice-queue-2026-10-28
status: accepted
implementation: partial
created: 2026-10-28
updated: 2026-10-28
parent: module.olympiad-preparation
uses:
  - shared.design.ui-kit
  - shared.access-and-privacy
consumers:
  - Education frontend
  - Education operator
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Практика и очередь загруженных вариантов

## Основание

28 октября родитель утвердил компактный список самостоятельных задач, загрузку решения в любом состоянии и очередь собственного варианта; попросил приступить без дополнительных вопросов.

## Было → стало

Свёрнутые задачи используют `ProblemCard`, а приём условий вынесен в `OlympiadSourceQueue` с уже существующими загрузчиком и галереей. Убраны обозначения домашнего задания и просьбы родителя, внутри сохранились условия и просмотр результатов.

Затронуты `src/DayPage.tsx`, `src/DayPage.css`, `src/UiKit.tsx`, `src/components/AssignmentBrief.tsx`, `src/components/OlympiadPage.tsx`, `src/components/OlympiadSourceQueue.tsx`, `src/components/WorkPhotoGallery.tsx`, `src/lib/educationStore.ts`.

## Действия и роли

Ребёнок загружает фото условия или решения, родитель просматривает очередь и результаты. После подтверждения передачи действует существующий событийный запуск EducationSync. Фактические результаты распознавания и статус выполнения оператора пока не отображаются автоматически.

## Проверки

Ролевые фикстуры `src/DayPage.assignmentQuiz.integration.test.tsx`, `src/components/OlympiadPage.integration.test.tsx`, `src/components/WorkPhotoGallery.test.tsx`, `src/UiKit.test.tsx`, события `sync/event-task-artifact.test.mjs` и браузерный сценарий `e2e/olympiad-ui-kit.e2e.ts`. Сквозное распознавание реального листа не заявлено проверенным.

## Согласование

Прямое указание родителя о реализации и публикации от 28.10.2026.
