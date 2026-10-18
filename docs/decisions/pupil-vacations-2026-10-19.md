---
id: decision.pupil-vacations-2026-10-19
status: accepted
implementation: implemented
parent: module.school-diary.school-calendar
uses:
  - module.school-diary.dashboard
  - shared.design.ui-kit
created: 2026-10-19
updated: 2026-10-19
consumers:
  - parent
  - student
  - sync operator
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
code:
  - src/components/DayCalendar.tsx
  - src/DayDashboard.tsx
  - scripts/sync-project.mjs
---
# Каникулы конкретного ученика

## Основание

Родитель19.10 попросил выделить каникулы блоком дней и прямо запретил общий календарь или придуманные даты: источник только МЭШ конкретного ученика.

## Было → стало

Полоса дат не различала каникулы и обычный день без уроков. Подтверждённый персональный календарь приходит через общий адаптер и штатный CLI, сохраняется в существующем dashboard и группируется общим `DayCalendar`. Нет новых стартовых экранов, маршрутов, подписок или автоматизаций. Неполный источник не заменяет подтверждённые данные пустотой.

## Действия и роли

Обе роли видят одинаковые даты своего ребёнка и сохраняют доступ к собственным заданиям. Цвет категории сопровождается знаком и подписью; выбранная дата/сегодня, пролистывание и работа на каникулах сохраняются. UI Kit демонстрирует реальный компонент на явно вымышленных датах. Сбор и публикация проверяют принадлежность семье, ребёнку и профилю МЭШ. Детали — в [контракте](../modules/school-diary/school-calendar.md).

## Проверки

`day/school-calendar.test.mjs`: происхождение, типы, непрерывность, неполнота и чужой ребёнок; `sync/school-calendar.test.mjs` и `packages/education-connect/lib/mesh-calendar.test.mjs`: scoped запрос и корректные параметры; `sync/school-calendar-publication.test.mjs`: атомарность, сохранение работы, readback и отсутствие лишних записей; `day/dashboard-index.test.mjs`: повторная публикация; `src/components/DayCalendar.test.tsx`, `src/DayDashboard.warmStart.test.tsx`, `src/UiKit.test.tsx`: выбор дат, обе роли, следующее ДЗ и общий пример. Общие gates — `npm run check`.

## Согласование

Прямой запрос пользователя19.10.2026 на этот видимый блок и pupil-specific источник. Подтверждённый ответ МЭШ получен штатным CLI; реальная семейная информация хранится только закрыто. Разработка и техническая проверка не подменяют визуальную приёмку пользователем.

Затронутые runtime-файлы: `day/school-calendar.mjs`, `day/school-calendar.d.mts`, `day/dashboard-index.mjs`, `day/data-contract.mjs`, `sync/school-calendar.mjs`, `sync/school-calendar-publication.mjs`, `packages/education-connect/lib/mesh.mjs`, `packages/education-runtime/mesh-session.mjs`, `scripts/sync-project.mjs`, `scripts/day.mjs`, `src/components/DayCalendar.tsx`, `src/DayDashboard.tsx`, `src/DayDashboard.css`, `src/education-design-tokens.css`, `src/lib/dayCompatibility.ts`, `src/lib/dayDashboardStore.ts`, `src/lib/uiKitExamples.ts`, `src/UiKit.tsx`.
