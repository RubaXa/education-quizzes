---
id: decision.olympiad-source-links-2026-10-28
status: accepted
implementation: partial
created: 2026-10-28
updated: 2026-10-28
parent: module.olympiad-preparation
uses:
  - shared.access-and-privacy
consumers:
  - Education operator
  - Education frontend
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Связь повторного фото с олимпиадной задачей

## Основание

Родитель поручил выделить задачи из фотографий, связывать дубликаты и использовать общую инфраструктуру и UI Kit.

## Было → стало

Ранее повторное фото условия нельзя было адресно прикрепить к существующей карточке. Теперь проверенная связь хранится отдельно от решений, а обе роли видят её через существующий компонент. Содержательное распознавание и проверку совпадения выполняет оператор.

Затронуты `day/olympiad-source-link.mjs`, `day/family-assignment.mjs`, `day/pipeline-contract.mjs`, `scripts/day.mjs`, `src/DayPage.tsx`, `src/lib/dayStore.ts`, `sync/event-task-artifact.mjs`.

## Действия и роли

Оператор сравнивает условие и рисунки, запускает адресную команду; ученик и родитель видят исходное фото, но запись и существующие решения не меняются.

## Проверки

Firebase Emulator проверяет владельца, совпадение, ролевые страницы, идемпотентность и сохранение статуса. Регрессии проекции и UI проверяются `day/family-assignment.test.mjs`, `day/pipeline-contract.test.mjs`, `src/DayPage.assignmentQuiz.integration.test.tsx`, `src/components/LinkedWorkPhotos.test.tsx`, `scripts/firestore-rules-help-emulator.test.mjs`. Реальное распознавание не подтверждено.

## Согласование

Прямое поручение родителя от 28.10.2026, выпуск запрошен без дополнительных согласований.
