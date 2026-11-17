---
id: decision.quiz-review-dialogue-2026-11-17
status: accepted
implementation: implemented
created: 2026-11-17
updated: 2026-11-17
parent: shared.design.student-review-step
uses:
  - module.assessments.quizzes
  - module.synchronization.event-queue
  - shared.design.ui-kit
consumers:
  - "student"
  - "parent"
  - "Education operator"
code:
  - packages/education-presentation/quiz-review-reply.mjs
  - packages/education-presentation/quiz-review-reply.d.mts
  - src/lib/quizCardViewModel.ts
  - src/lib/quizReviewConversation.ts
  - src/components/QuizResultConversation.tsx
  - src/components/ReviewConversation.tsx
  - src/components/QuizResultCard.tsx
  - src/components/QuizAttemptReview.tsx
  - src/App.tsx
  - packages/education-events/envelope.mjs
  - sync/event-task-artifact.mjs
  - sync/help-response.mjs
  - src/ui-kit/QuizReviewDialogueExample.tsx
  - src/components/ReviewBriefShowcase.tsx
  - firestore.rules
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Ответ на текущий шаг в результате теста

## Основание

Родитель17.11 потребовал привести действующие разборы к одному адаптивному блоку,
выбирать режим по настоящим ответам и проверить обе роли. При ролевой проверке
обнаружено: QuizResultCard отображал activity без отправки. Регрессия
QuizResultCard.dialogue.test.tsx воспроизводит отсутствие кнопки. Локальный выбор
не выполняет контракт [диалога](../shared/design/student-review-step.md#отправка-и-ответ).

## Было → стало

Результат вопроса подключает тот же ReviewConversation, что письменная работа.
quizStepReplies/{token}/items/{questionId} и неизменяемая requests/{eventId} сохраняют
собственный микроответ вместе с help.requested. quizStepGuidance/{token}/items/help-{eventId}
содержит проверенный отклик. Нового расписания и нового типа события нет.
Снимок root question/activity в correctedAt обозначает версию учебного шага, а
checkedAt — submittedAt исходной попытки. Изменённый вопрос или модель закрывают
старый контекст. Ни ключ, ни полный ответ в снимок не входят.

При живой проверке обнаружена утечка через название фрагмента источника: оно
называло действие, о котором спрашивал текущий шаг. Публикуемые метаданные исправлены
на нейтральные. У активного ученического вопроса общий компонент показывает книгу,
издание и страницу; свободные section/locator сохраняются в родительском источнике.
Регрессия проверяет весь HTML раскрытий, а не только первый экран.

## Действия и роли

Ребёнок выбирает, отправляет ответ или «Непонятно», видит ожидание и проверенный
переход. Родитель читает тот же результат, реальный ответ и отклик, без редактора.
Счёт, ответы исходного теста, обязательность и цепочка продолжений не меняются.
Rules ограничивают запись действующим учеником нужной семьи, точным опубликованным
шагом, submittedAt и атомарной историей/событием. Ответ оператора закрыт для клиента.
Проверяющий повторно вычисляет результат по ключу и частной рубрике; верный,
исключённый, пропущенный или ожидающий проверки вопрос не становится новой ошибкой.
Адресное поручение содержит реальную попытку, источники, ключ и выданную помощь.
Штатный help-response публикует micro-step evidence, не полный зачёт или mastery.

## Проверки

Реальный клик в общем компоненте; выбор до отправки, pending, неизменные баллы и
родитель без полей. Emulator: отправка → поручение → отклик → следующий шаг;
подмена вопроса/контекста/владельца, отсутствие истории, запись родителем и ответ
клиентом запрещены. Общие regressions письменного диалога сохраняются.
Сверка живых карточек обеих ролей не создаёт ответы от имени ребёнка.

## Согласование

Прямой запрос родителя17.11: «приведи старые разборы к этому общему блоку» и
«проверь карточки обеих ролей». Отправка и обработка — действующий контракт блока.
