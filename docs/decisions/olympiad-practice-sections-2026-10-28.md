---
id: decision.olympiad-practice-sections-2026-10-28
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
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Отдельные разделы приёмов и практики

## Основание

Родитель сообщил, что задачи слиплись и выглядят продолжением тестов; попросил отдельный блок практики.

## Было → стало

Существующие карточки тестов выводятся в разделе «Приёмы и тесты», письменные задачи — в разделе «Практика». Между задачами общий токен интервала; очередь своих вариантов после задач. Рендер остаётся на существующих подписках и компонентах. Затронуты `src/DayPage.tsx`, `src/DayDashboard.css`, `src/UiKit.tsx`, `src/components/OlympiadPage.tsx`, `src/education-design-tokens.css`.

## Действия и роли

Родитель и ученик видят одни разделы; карточки раскрываются как прежде, доступы и существующие события LDD не меняются.

## Проверки

Ролевые фикстуры DayPage и OlympiadPage, примеры UI Kit, Playwright на мобильном экране, проверки спецификаций и сборка.

## Согласование

Прямое сообщение родителя 28.10.2026.
