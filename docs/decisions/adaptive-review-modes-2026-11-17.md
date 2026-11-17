---
id: decision.adaptive-review-modes-2026-11-17
status: accepted
implementation: implemented
created: 2026-11-17
updated: 2026-11-17
parent: shared.design.student-review-step
uses:
  - module.assignments.deadline-control
  - module.reviews.criteria-and-knowledge
  - module.synchronization.subject-decision-graph
  - shared.design.ui-kit
consumers:
  - "student"
  - "parent"
  - "Education operator"
code:
  - day/decision-registry.mjs
  - day/task-requirement.mjs
  - packages/education-presentation/review-activity.mjs
  - packages/education-presentation/review-reply.mjs
  - packages/education-presentation/task-presentation.mjs
  - scripts/check-review-brief-viewport.mjs
  - scripts/check-schedule-viewport.mjs
  - src/DayPage.tsx
  - src/UiKit.tsx
  - src/components/PhotoHelpPanel.tsx
  - src/components/PhotoHelpRequest.tsx
  - src/components/ProblemStatement.css
  - src/components/QuizAttemptReview.tsx
  - src/components/QuizResultCard.tsx
  - src/components/RequirementSwitch.css
  - src/components/ReviewActivity.css
  - src/components/ReviewActivity.tsx
  - src/components/ReviewBrief.tsx
  - src/components/ReviewConversation.tsx
  - src/components/SubjectRequirementSwitch.tsx
  - src/lib/dayGuidance.ts
  - src/lib/dayStore.ts
  - src/lib/homeworkStatus.ts
  - src/lib/parentCompletion.ts
  - src/lib/useSubjectRequirementCommand.ts
  - src/ui-kit/AssignmentClarificationExample.tsx
  - src/ui-kit/DecisionScenarioCatalog.tsx
  - src/ui-kit/ReviewConversationExample.tsx
  - sync/deadline-control.mjs
  - sync/deadline-evidence.mjs
  - sync/event-task-artifact.mjs
  - sync/help-response.mjs
  - src/App.tsx
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Один адаптивный блок учебного диалога

## Основание

Родитель17.11 одобрил три исследованных режима как состояния одного блока.
Переход выбирается по ответу и поддержке ребёнка, с учётом предмета. Варианты должны
выглядеть нажимаемыми. Уточнение назначения не требует фото; противоречие с учителем
передаётся родителю. Семейная обязательность управляется его переключателем.
Основания: [действующий контракт](../shared/design/student-review-step.md#adaptive-support),
[Duolingo: узнавание и собственный ответ](https://blog.duolingo.com/duolingo-101-how-to-learn-a-language-on-duolingo/),
[MATHia: адресные шаги и помощь](https://support.carnegielearning.com/help-center/math/home-connection/mathia-support22/article/mathia-family-guide/),
[W3C: понятные подписи](https://www.w3.org/WAI/tutorials/forms/instructions/).
Наличие разных форм ответа не доказывает превосходства одного для всех предметов.

## Было → стало

Вместо безымянного выбора renderer — один ReviewActivity с choice/mark/build/sort/write.
Сервер фиксирует support-переход по сохранённому ответу, блокирует прежнюю модель
после stuck и повтор свободного ввода после затруднения в нём. Молчание ничего не
диагностирует. У родителя нет ученического редактора; сохраняется фактический ответ.
Убраны пустой placeholder и дублированная инструкция. Выбор — явные радиостроки.
condition-запрос без фото идёт через существующую очередь с неизменяемой историей;
его ответ требует сверки условия/архива и явного маршрута clarified/ask-child/ask-parent.
Переключатель предмета сохраняет отдельные task-required/task-optional события;
родительское решение переживает публикацию условий и не меняет зачёт/оценку.

## Действия и роли

Ребёнок выбирает, работает с моделью, пишет или сообщает о затруднении. Он не может
выбрать себе зачёт, отключить задание либо записать ответ проверяющего. Родитель
видит ответ, закрытый полный путь и меняет только семейный план. Уже присланные
оригиналы/фото/история не удаляются. Явно опциональное сохраняется таким до выбора
родителя. Выбор не является утверждением, что учитель отменил задание.

Область: общие разборы WorkReview, помощь PhotoHelpPanel, дневник DayPage, UI Kit,
нативная публикация help-response и связанные общие данные/граф. Это не означает
автоматической смысловой миграции всех старых текстов; она требует адресного пакета
и обратного чтения. Тестовые ответы сохраняют собственный протокол отправки;
стабильная общая оболочка заданий остаётся прежней.

Контроль срока использует тот же чистый taskRequired, что интерфейс; выбор семьи
адресно читается один раз для своей ближайшей страницы. Новых расписаний нет.

## Проверки

Красные сценарии: родительский input, отсутствие choice, невозможность текстового
уточнения без фото, отсутствие отдельного семейного выбора. Затем ролевые DOM
тесты, клавиатура, повтор/ожидание/история, безопасная проекция и приватный переход,
сохранность вердикта/работы, неизменяемость уточнения и parent-only выбор в Rules
emulator. Полная проверка npm run check и визуальная проверка320/390/540px обязательны
перед выпуском. Фактические квитанции выпуска дополняются после выполнения.

В полном параллельном прогоне2333проверки прошли, а календарный браузерный тест
не успел получить DevTools за5секунд; отдельно тот же тест прошёл с Chrome и Canary.
Для запуска браузера предусмотрено ограниченное ожидание15секунд с немедленной
ошибкой при завершении процесса. Ожидания геометрии и общий timeout не ослаблены.

Проверка production CSS теперь требует отсутствия пустого результата до действия
ребёнка и сохраняет проверки границ карточки/вопроса/модели и светлой/тёмной темы.
Старое ожидание рамки вокруг пустого псевдоответа противоречило новому контракту.

## Согласование

Прямое решение пользователя17.11: все три режима одного блока, выбор по пониманию,
уточнение детского ответа, решение родителя при споре, обязательность по умолчанию
с переключателем, переиспользуемая карточка и выбор из UI Kit. Нового расписания нет.

Затронутые файлы:

- `day/decision-registry.mjs`
- `day/task-requirement.mjs`
- `packages/education-presentation/review-activity.mjs`
- `packages/education-presentation/review-reply.mjs`
- `packages/education-presentation/task-presentation.mjs`
- `scripts/check-review-brief-viewport.mjs`
- `scripts/check-schedule-viewport.mjs`
- `src/DayPage.tsx`
- `src/UiKit.tsx`
- `src/components/PhotoHelpPanel.tsx`
- `src/components/PhotoHelpRequest.tsx`
- `src/components/ProblemStatement.css`
- `src/components/QuizAttemptReview.tsx`
- `src/components/QuizResultCard.tsx`
- `src/components/RequirementSwitch.css`
- `src/components/ReviewActivity.css`
- `src/components/ReviewActivity.tsx`
- `src/components/ReviewBrief.tsx`
- `src/components/ReviewConversation.tsx`
- `src/components/SubjectRequirementSwitch.tsx`
- `src/lib/dayGuidance.ts`
- `src/lib/dayStore.ts`
- `src/lib/homeworkStatus.ts`
- `src/lib/parentCompletion.ts`
- `src/lib/useSubjectRequirementCommand.ts`
- `src/ui-kit/AssignmentClarificationExample.tsx`
- `src/ui-kit/DecisionScenarioCatalog.tsx`
- `src/ui-kit/ReviewConversationExample.tsx`
- `sync/deadline-control.mjs`
- `sync/deadline-evidence.mjs`
- `sync/event-task-artifact.mjs`
- `sync/help-response.mjs`
- `firestore.rules`
- `src/App.tsx`
