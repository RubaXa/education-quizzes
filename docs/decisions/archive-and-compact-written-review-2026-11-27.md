---
id: decision.archive-and-compact-written-review-2026-11-27
status: accepted
implementation: implemented
created: 2026-11-27
updated: 2026-11-27
parent: module.school-diary.dashboard
uses:
  - module.assignments.source-units
  - module.reviews.marked-work-sheet
consumers:
  - student
  - parent
  - UI Kit
code:
  - src/DayDashboard.tsx
  - src/DayPage.tsx
  - src/components/WorkReview.tsx
  - scripts/check-review-brief-viewport.mjs
  - src/components/TaskDisclosure.css
  - src/components/AssignmentUnits.tsx
  - src/components/WrittenReviewSheet.tsx
  - src/components/WrittenReviewSheet.css
  - src/components/PreparationCards.tsx
  - src/components/PreparationCards.css
  - src/lib/useViewChoices.ts
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Архив подготовки и компактный письменный разбор

## Основание

Скриншоты27.11 показывают старую подготовку18/24.11 в текущем дне, высокие
плашки упражнений и перенос вкладки «Лист с пометками». Пользователь просит
убрать старую подготовку в архив, назвать разбор, дать сворачивание с памятью.
Отдельное уточнение: архив — иконка, без видимой текстовой кнопки.

Затронутые файлы: `src/DayDashboard.tsx`, `src/DayPage.tsx`, `src/components/WorkReview.tsx`, `scripts/check-review-brief-viewport.mjs`, `src/components/TaskDisclosure.css`, `src/components/AssignmentUnits.tsx`, `src/components/WrittenReviewSheet.tsx`, `src/components/WrittenReviewSheet.css`, `src/components/PreparationCards.tsx`, `src/components/PreparationCards.css`, `src/lib/useViewChoices.ts`.

## Было → стало

Подготовка после срока больше не обязана занимать текущий обзор: иконка
убирает выбранную проекцию в свёрнутый архив с возвратом. Автоматического
зачёта или удаления нет. Локальный выбор относится к человеку/ролевому
календарю, дате урока и набору taskId. Архив не создаёт клиентских чтений.

Внутренний WrittenReviewSheet называется «Проверка работы», изначально открыт.
Кнопка сохраняет ручное сворачивание на устройстве по роли и ID работы;
содержимое остаётся смонтированным. Однословная вкладка — «Разбор».
AssignmentUnits сохраняет TaskDisclosure, но размещает статус и страницы
компактнее. Повтор страницы у аудио убирается только в краткой подписи.

## Действия и роли

Рёбра подготовки и review:support → support:component не меняются; прежние
WeekendMathSlot, WorkReview, WrittenReviewSheet и AssignmentUnits остаются
единственными представлениями самих работ. Архив — предпочтение обзора,
не изменение задания, обязательности или статуса. Исходный день сохраняет
полный доступ. У обеих ролей остаются оригиналы, пометки, история и действия;
закрытые родительские ответы не переносятся в ученическую проекцию.

## Проверки

RED: интеграция WorkReview не находит «Разбор» и управляющую кнопку.
GREEN: обе роли сворачивают, повторно открывают и после remount сохраняют
выбор. Проверены комментарии, оригиналы, неизменность исходного результата.
PreparationCards тестирует архив, remount, изоляцию scope, возврат и отсутствие
архива будущего срока. Прежние WeekendMathSlot и DayPage интеграции сохранены.
Регрессии реального LearningRoute проверяют смену человека через запоздалые
события device/grant/member: локальное предпочтение не запускает авторизационный
запрет во время перехода.
Headless viewport проверяет production CSS обеих ролей на320/375/390/430px:
вкладки в одну строку, нет overflow, цели44px, компактная высота пунктов,
аудио сохранено и страница не дублируется. Computer Use не используется.

## Согласование

Прямой запрос27.11.2026 по двум скриншотам и уточнение об иконке архива.
Ручной архив вместо молчаливого удаления сохраняет школьный объём и историю.
Состояние хранится только на этом устройстве; серверные учебные данные не меняются.
Прежняя авторизация прямого выпуска сайта действует.
