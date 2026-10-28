---
id: decision.olympiad-firebase-independence-2026-10-28
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
# Независимая обработка загруженного листа

## Основание

Родитель потребовал независимо обработать подтверждённое событие Firebase и добавить задачи загруженного листа в практику.

## Было → стало

Смешанная заявка блокировала Firebase после сбоя МЭШ. Локально для замороженного диапазона создаётся независимая action lane; проверенные вручную фрагменты можно публиковать в существующих семейных карточках. Новые действия могут проходить после старого диапазона с отсутствующим источником, не помечая этот диапазон завершённым. Автоматическое распознавание изображений не реализовано, доставка и живой readback проверяются отдельно. Совпадающая локальная копия переданного снимка не возвращает очередь в ожидание. Затронуты `day/family-assignment.mjs`, `day/pipeline-contract.mjs`, `scripts/day.mjs`, `packages/telegram-notifications/application/education-sync-dispatcher.mjs`, `sync/event-task-artifact.mjs`, `sync/task-route.mjs`, `src/DayPage.tsx`, `src/UiKit.tsx`, `src/components/OlympiadPage.tsx`, `src/components/OlympiadSourceQueue.tsx`, `src/components/WorkPhotoGallery.tsx`, `src/lib/dayStore.ts`, `src/lib/educationStore.ts`.

## Действия и роли

Ученик открывает исходный фрагмент и загружает решение; родитель видит те же карточки и фото. Пока действует запрет нейросетей, подсказки и обработка решения отключены. Фото условий не является фото решения.

## Проверки

Ролевые интеграционные фикстуры страницы, сохранение семейного назначения, события и action lane; UI Kit, Playwright, спецификации и сборка.

## Согласование

Прямое поручение родителя 28.10.2026.
