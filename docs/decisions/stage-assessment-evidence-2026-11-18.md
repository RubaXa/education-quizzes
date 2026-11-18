---
id: decision.stage-assessment-evidence-2026-11-18
status: accepted
implementation: implemented
consumers:
  - parent
  - student
  - sync operator
code:
  - src/lib/stageAssessment.ts
  - src/components/StageAssessment.tsx
  - day/stage-assessment.mjs
  - storage/task-presentation-edit.mjs
uses:
  - module.school-diary.day-page
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
created: 2026-11-18
updated: 2026-11-18
parent: module.school-diary.day-page
---
# Связанный тест и непрерывная сдача работы

## Основание
Родитель 18 ноября показал непройденный этап английского при пройденном тесте, отсутствие загрузки у письменной подготовки с тестом и заголовок спецкурса по одной букве.

## Было → стало
Этап считал только фото; теперь адресная проверенная связь использует результат существующей цепочки. QuizLineageCard обходил галерею и загрузку; теперь они остаются частью задания. На мобильном статус больше не сжимает заголовок спецкурса.

## Действия и роли
Ученик переходит из этапа в свой тест и загружает работу общим контролом. Родитель видит тот же результат, полный прежний разбор и фото. Семейные отключения сохраняются; тест подтверждает только указанную готовность, не устную запись. Связь назначается оператором по источнику и проверяется CLI перед публикацией.

## Проверки
Регрессии смешанного задания, цепочки продолжений, ожидания результата, выключенного этапа и загрузки обеих ролей. Production CSS на 320/390/540px. Полный npm run check, адресный readback и обе живые роли.

## Согласование
Прямой запрос пользователя в текущем сообщении; сохранены прежние компоненты и смысл задания.

Файлы реализации: `day/build.mjs`, `scripts/check-problem-variant-viewport.mjs`, `scripts/day.mjs`, `src/DayPage.css`, `src/DayPage.tsx`, `src/components/ParentTaskGuide.tsx`, `src/lib/dayStore.ts`, `src/lib/homeworkStatus.ts`, `src/lib/useDayQuizOutcomes.ts`, `day/source-only.mjs`, `day/decision-registry.mjs`, `src/ui-kit/DecisionScenarioCatalog.tsx`, `storage/task-presentation-edit.mjs`, `day/stage-assessment.mjs`, `src/components/StageAssessment.tsx`, `src/lib/stageAssessment.ts`, `src/ui-kit/StageAssessmentExample.tsx`.

Для той же английской карточки адресно исправляется устаревшее пояснение о неизвестной записи: learnerFlowBoundary с точным ожидаемым прежним значением. Цель, область МЭШ, источник и этапы помощи не редактируются.

Повторная публикация: `day/build.mjs`, `day/merge.mjs` и `day/source-only.mjs` сохраняют связь только при неизменном условии; новое условие снимает её вместе с прежним маршрутом.
