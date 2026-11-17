---
id: decision.parent-review-pilot-2026-11-17
status: accepted
implementation: implemented
created: 2026-11-17
updated: 2026-11-17
parent: module.reviews.parent-review
uses:
  - shared.design.ui-kit
  - shared.access-and-privacy
consumers:
  - "parent"
  - "student"
  - "Education operator"
code:
  - packages/education-presentation/parent-review.mjs
  - packages/education-presentation/parent-review.d.mts
  - src/components/ParentReviewContent.tsx
  - src/components/QuizResultCard.tsx
  - src/components/QuizResultConversation.tsx
  - src/components/ReviewConversation.tsx
  - src/lib/quizParentReview.ts
  - storage/quiz-parent-review.mjs
  - scripts/quiz-parent-review.mjs
  - day/decision-registry.mjs
  - src/ui-kit/ParentReviewPilotExample.tsx
  - src/ui-kit/DecisionScenarioCatalog.tsx
  - src/components/ReviewBriefShowcase.tsx
  - src/UiKit.tsx
  - packages/education-presentation/task-presentation.mjs
  - src/components/ReviewActivity.tsx
  - firestore.rules
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Один вопрос: разные продукты для родителя и ребёнка

## Основание

Родитель17.11 указал: отключённый ввод не превращает ученическую подсказку в полный
родительский разбор. Нужны правильный ответ, наблюдаемая ошибка и понятный ход.
Общее правило относится ко всем предметам; содержательный пилот — один вопрос.

## Было → стало

QuizResultCard передавал обеим ролям одинаковый вопрос. Новый ParentReviewContent
показывает правильный ответ и отличие от фактической попытки сразу, полный метод и
структурированные доказательства — в «Ход разбора». Используются ReviewBrief,
MethodOverview и SolutionBlocks; отдельного предметного renderer нет.
Ученику остаётся прежний ReviewConversation с подсказкой и моделью без нового ключа.

## Действия и роли

Полный разбор хранится отдельно в quizParentReviews/{token}/items/{questionId}.
Только родитель своей семьи читает адресный документ; ученик не подписывается и не
получает его в props или проекции. Смена роли/попытки немедленно закрывает старый
scope. ParentReviewContent не оценивает работу и не меняет семейную обязательность.
История диалога, оценка, исходный ответ и действия ученика сохраняются.
Пилот не переписывает остальные задания. Совместимость старых записей не означает,
что их содержательная миграция завершена.

## Проверки

Красный тест воспроизводит отсутствие правильного ответа. Регрессии проверяют
обе роли, полный HTML раскрытий, родительский ход и отсутствие полей ввода.
Native CLI подтверждает конкретную попытку и источник, архивирует коррекцию,
пишет только закрытый родительский документ и служебную историю, перечитывает их.
Emulator доказывает доступ своего родителя и запрет для ребёнка/другой семьи.
UI Kit показывает обе роли одной условной задачи и связан с узлами/рёбрами графа.
Живой пример сверяется с оригиналом и обеими ролями после публикации.

## Согласование

Прямой запрос17.11: правильный ответ и разбор у родителя, подсказки у ребёнка;
сначала одна задача, каждое решение закрепить в спецификации и графе.

Первоначальный отдельный вид «Ход разбора» отклонён родителем в тот же день.
[Коррекция](restore-parent-route-2026-11-17.md) сохраняет этот ролевой доступ и
данные, но возвращает канонический ParentTaskGuide; прежний renderer не является
основанием для дальнейшего нового дизайна.
