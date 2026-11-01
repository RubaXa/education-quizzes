---
id: decision.student-review-step-2026-11-01
status: accepted
implementation: implemented
created: 2026-11-01
updated: 2026-11-01
parent: shared.design.student-review-step
uses:
  - shared.design.compact-review
  - shared.design.ui-kit
consumers:
  - "learner"
  - "parent"
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Текущий ученический шаг вместо текстового остатка

## Основание

Родитель01.11 отверг разрыв между понятным полным родительским интерактивом и сухим
ученическим текстом. Прямо потребовал исправить все ученические разборы, общие правила,
UI Kit и проверить фактическую проекцию ученика. Сокращение абзаца не выполняет это требование.

## Было → стало

Общий ReviewActivity поддерживает выделение, сборку, группировку и собственную запись.
SVG-схема/поле/цепочка связаны с тем же набором данных; выражение отображается MathML.
Отклик отражает собственный выбор без вычисления неизвестного и без зачёта. Повторяющая
статичная опора не выводится рядом со своей интерактивной моделью. Полный родительский
путь сохраняет собственный renderer. Ученический preview в UI Kit использует public projector.

Адресный редактор сохраняет статус/checkedAt/историю/файлы/семейные решения и архивирует
предыдущий вид; по исходным digest не разрешает перезаписать новую работу. Технические
оговорки родительского basis не показываются в ученическом WorkReview. Охват содержательной
миграции подтверждается отдельным закрытым readback; один пример не означает миграцию всех.

Затронутые файлы:
- `src/lib/dayStore.ts`
- `assessment/question-guidance.mjs`
- `operator/olympiad-help.mjs`
- `packages/education-presentation/review-activity.d.mts`
- `packages/education-presentation/review-activity.mjs`
- `packages/education-presentation/review-content.d.mts`
- `packages/education-presentation/review-content.mjs`
- `scripts/check-review-brief-viewport.mjs`
- `scripts/olympiad-help.mjs`
- `scripts/student-review.mjs`
- `scripts/submissions.mjs`
- `src/UiKit.tsx`
- `src/components/OlympiadWrittenPractice.tsx`
- `src/components/PhotoHelpRequest.tsx`
- `src/components/QuizResultCard.tsx`
- `src/components/ReviewActivity.css`
- `src/components/ReviewActivity.tsx`
- `src/components/ReviewBrief.css`
- `src/components/ReviewBrief.tsx`
- `src/components/ReviewBriefShowcase.tsx`
- `src/components/WorkReview.tsx`
- `src/lib/quiz.ts`
- `src/lib/reviewBriefExamples.ts`
- `src/lib/reviewStepExamples.ts`
- `src/lib/workReviewBrief.ts`
- `storage/review-projection.d.mts`
- `storage/student-review-edit.mjs`
- `sync/olympiad-help.mjs`

## Действия и роли

Текущий вопрос и уже принятая часть сохраняются. Интерактив локальный, без новых сетевых
чтений клиента, сохранения попытки, скрытого ключа и автооценки. Родительский полный путь,
доступ к источникам, история и действия остаются. Готовые ответы не копируются в public.
Новые проверки/quiz guidance/photo-help CLI требуют осмысленной публичной модели;
исторический результат остаётся читаемым без выдумывания педагогики автоматически.

## Проверки

RED: действующий WorkReview теряет activity из настоящего public projector. GREEN:
та же публичная проекция позволяет собирать выражение без вычисления результата,
сохраняет статус и скрывает модель после зачёта. Вложенные answer/correct/expected,
посторонний anchor и устаревшие digest отклоняются. Проверяются четыре действия,
сброс/смена модели, обе роли,320/390/540px, клавиатура и production CSS. Финальное
обратное чтение и живой ученический экран — отдельное условие завершения выпуска.

## Согласование

Прямое требование родителя01.11. Короткий PR и штатные main/source/publish gates;
исходящих межчатовых сообщений нет. Новых production rules/ролей этот выпуск не вводит.
