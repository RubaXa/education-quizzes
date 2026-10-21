---
id: decision.collapsed-variant-status-2026-10-21
status: accepted
implementation: implemented
created: 2026-10-21
updated: 2026-10-21
consumers:
  - "Education parent and student UI"
  - "frontend developer"
code:
  - "src/components/ProblemGroup.css"
  - "src/components/PracticeVariantStatus.css"
  - "src/DayDashboard.tsx"
  - "scripts/check-requirement-copy.mjs"
  - "src/lib/practiceVariantViewModel.ts"
  - "src/DayPage.tsx"
  - "src/components/ProblemGroup.tsx"
  - "src/components/ParentTaskGuide.tsx"
  - "src/components/QuizCard.tsx"
  - "src/components/WorkReview.tsx"
  - "src/components/PracticeVariantStatus.tsx"
  - "src/lib/homeworkStatus.ts"
  - "src/lib/parentCompletion.ts"
  - "src/lib/problemGroupSummary.ts"
  - "src/UiKit.tsx"
parent: module.school-diary.day-page
uses:
  - shared.design.statuses
  - shared.design.ui-kit
  - module.assignments
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Статусы свёрнутых вариантов и необязательной работы

## Основание

Запрос 21.10.2026: в спецкурсе с восемью вариантами внутренние задачи №7 и №8 имеют статусы «Проверено» и «Исправить», но заголовки вариантов показывают только «По желанию». Фактическая проверка должна быть видна на внешнем уровне независимо от обязательности.

## Было → стало

Заголовок варианта агрегировал только число проверенных задач, а необязательность подменяла этот результат общей надписью. Теперь чистая ViewModel выводит проверенные, частичные, требующие исправления и ещё не начатые состояния вместе с прогрессом; решение об обязательности не является аргументом этой проекции. Необязательная/не начатая работа не становится завершённой автоматически. Удалены метки необязательности из статусных бейджей и результата этапа.

Затронутые продуктовые файлы: `src/DayPage.tsx`, `src/components/ProblemGroup.tsx`, `src/components/ParentTaskGuide.tsx`, `src/components/QuizCard.tsx`, `src/components/WorkReview.tsx`, `src/components/PracticeVariantStatus.tsx`, `src/lib/homeworkStatus.ts`, `src/lib/parentCompletion.ts`, `src/lib/problemGroupSummary.ts`, `src/lib/practiceVariantViewModel.ts`, `src/UiKit.tsx`.

## Действия и роли

Родительский переключатель остаётся единственным визуальным индикатором выбора обязательности и сохраняет исходную доступную подпись. Учительские цитаты и учебные инструкции не переписываются. Проверенные ответы и исправления остаются видны в свёрнутом заголовке и внутри задачи для обеих ролей.

## Проверки

`scripts/check-requirement-copy.mjs` проверяет JSX без выполнения приложения; новый видимый текст контролов отклоняется независимо от регистра. `scripts/check-requirement-copy.test.mjs` сохраняет допустимость aria-названий и цитат. Проверка включена в `check:spec` и pre-commit с чтением подготовленных Git blobs.

Добавлены unit-регрессии проекции статуса и изменения в интеграционных ожиданиях варианта, тесты UI Kit и быстрый guard, запрещающий метки «По желанию», «Обязательно», «Опционально» в названиях variant status badges. Остаются обязательными сборка, типизация, check:spec, UI Kit и браузерная проверка production-пути родителя.

## Согласование

Прямая инструкция пользователя 21.10.2026: исправить прогресс/статус в свёрнутых вариантах и группах независимо от обязательности; переключатель — единственный индикатор обязательности. В выпуске main требуется отдельная production-проверка.

Дополнительно затронут `src/DayDashboard.tsx`: убраны подписи обязательности из бейджа и объяснения, включая отображение прежнего кэшированного optional-бейджа. Регрессия: `src/DayDashboard.warmStart.test.tsx`.

`src/components/PracticeVariantStatus.css` связывает цвет заголовка с общими статусными токенами независимо от окружающего экрана. Выходной обзор проверяет ту же фактическую сводку через `src/WeekendMathSlot.test.tsx`.

`src/components/ProblemGroup.css` разрешает перенос длинного слова заголовка, чтобы сводка и стрелка не перекрывали название на телефоне.
