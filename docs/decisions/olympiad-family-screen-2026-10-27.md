---
id: decision.olympiad-family-screen-2026-10-27
status: accepted
implementation: partial
created: 2026-10-27
updated: 2026-10-27
parent: module.olympiad-preparation
uses:
  - shared.design.ui-kit
  - module.families.browser-access-trace
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
# Семейный экран подготовки к олимпиаде

## Основание

Пользователь поручил подключить семейные экраны, хранение, синхронизацию и учебные материалы, использовать существующие компоненты UI Kit и фиксировать действия в LDD.

## Было → стало

В домашнем экране семьи доступен каталог с выбором участия, отдельная страница показывает уроки и родительский разбор авторизованных попыток. Примеры в UI Kit используют те же компоненты. Клиент включается только при наличии безопасного адреса сервиса; серверная граница и данные пока не выпущены в production. Взаимодействия фиксируются в существующем локальном LDD без содержимого ответов и личных идентификаторов. Инфраструктура, передача фото, выдача помощи и публикация материалов остаются незавершёнными.

Затронуты `src/App.tsx`, `src/DayDashboard.tsx`, `src/UiKit.tsx`, `src/components/LearningRoute.tsx`, `src/components/PersonalEntry.tsx`, `src/components/OlympiadCatalog.tsx`, `src/components/OlympiadHome.tsx`, `src/components/OlympiadPage.tsx`, `src/components/OlympiadLesson.tsx`, `src/lib/olympiad/client.ts`, `src/lib/browserAccessTrace.ts`, `sync/olympiad-help.mjs`, `sync/job-queue.mjs`, `sync/task-route.mjs`, `scripts/sync-inbox.mjs`, `scripts/sync-queue.mjs`, `scripts/firestore-read-index.mjs`.

## Действия и роли

Проверенное сервером членство определяет доступ; URL не задаёт роль. Родитель включает подготовку только при подтверждённом допустимом классе и открывает разбор; ученик видит выбранные уроки и свои ответы без ключей. LDD хранит ограниченные события в текущей браузерной сессии, не является агрегированной аналитикой.

## Проверки

Интеграционные тесты семейного маршрута, учебной страницы, UI Kit и сервера; отдельные проверки очереди и Firestore Emulator. Готовность к выпуску требует публикации проверенных данных и развёрнутого авторизованного сервиса.

## Согласование

Прямое поручение пользователя реализовать сценарий без дополнительных согласований и сохранять решения в спецификациях.
