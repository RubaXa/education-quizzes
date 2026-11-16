---
id: decision.assignment-source-audit-corrections-2026-11-16
status: accepted
implementation: implemented
created: 2026-11-16
updated: 2026-11-16
parent: product.ui-change-control
uses:
  - module.assessments.quizzes
  - module.reviews.review-criteria-provenance
  - shared.design.ui-kit
consumers:
  - student
  - parent
  - Education operator
code:
  - assessment/decision-graph.mjs
  - assessment/followup-contract.mjs
  - assessment/manual-review-contract.mjs
  - assessment/quiz-author-scope.mjs
  - assessment/quiz-lineage.mjs
  - day/data-contract.mjs
  - scripts/quiz.mjs
  - scripts/submissions.mjs
  - src/App.tsx
  - src/DayPage.tsx
  - src/components/QuizAttemptReview.tsx
  - src/components/QuizCard.tsx
  - src/components/QuizQuestionCard.tsx
  - src/components/QuizResultCard.tsx
  - src/components/WorkReview.tsx
  - src/lib/dayStore.ts
  - src/lib/quiz.ts
  - src/lib/quizCardViewModel.ts
  - src/lib/store.ts
  - src/ui-kit/QuizRunnerExample.tsx
  - src/ui-kit/ReviewConversationExample.tsx
  - storage/context-evidence-projection.mjs
  - storage/context-evidence.mjs
  - storage/review-projection.mjs
  - storage/review-readback.mjs
sections:
  - reason
  - change
  - roles
  - verification
  - authorization
---
# Коррекция объёма задания и квитанция факта

## Основание {#reason}

Прямой запрос родителя 16.11: сверить все текущие назначения с записью учителя
и оригиналами, убрать придуманное, сохранить уже присланное без повторных запросов.
Аудит обнаружил посторонние вопросы в уже отправленных самопроверках и скриншот
внешнего результата, который не является новым обязательным цифровым заданием.

## Было → стало {#change}

Вопрос вне назначения влиял на знаменатель и наблюдение навыка. Теперь отдельная
адресная авторская коррекция исключает его из зачёта, сохраняя вопрос, собственный
ответ и ключ. Балл не дарится, исключение не означает освоение. Результат, счётчики,
ручная проверка и продолжение используют общую модель исключённых ID. До начала
ordinary допускается явная авторская ревизия по источникам; после начала этот путь
закрыт. История, CAS и обе ролевые записи обязательны.

Результат платформы ранее можно было записать лишь как оценку выполнения либо
источник запрошенного материала. Теперь context-evidence сохраняет адресную
квитанцию и исходный upload отдельно от учебного вердикта. Reading, обязательность,
сдача и прежняя самопроверка остаются самостоятельными фактами. Учебное наблюдение
из неизвестного содержания внешнего теста не создаётся.

## Действия и роли {#roles}

Оператор сверяет смысл основания с оригиналом; CLI проверяет форму, владельца,
текущую версию и адресный readback. Закрытая причина и предыдущие данные сохраняются. Подтверждённая закрытым
реестром legacy-привязка допускает отсутствие заголовка ученического списка:
исторический publisher создавал только дочерние документы. Отсутствие входит
в CAS и readback, новый владелец не назначается; чужой владелец или явно неверная
роль отклоняются.
Ученик и родитель видят нейтральное исключение либо краткую квитанцию через общие
QuizQuestionCard, ResultCard и WorkReview. Родительский полный разбор не открывается
ребёнку. Ввод, отправка, фото, история, свёрнутость и существующие семейные решения
сохраняются; новых расписаний и автоматической пересдачи нет.

## Проверки {#verification}

RED→GREEN: src/lib/quiz.authorScope.test.ts, assessment/quiz-author-scope.test.mjs
проверяют знаменатель, нулевой объём, stale/foreign/CAS, сохранность ответа/ключа
и unknown-коррекцию знаний; followup/manual-review/lineage сохраняют допустимые
сценарии. storage/context-evidence.test.mjs и scripts/submissions.context-evidence.test.mjs
проверяют native validate/review, запись и readback без вердикта/наблюдения навыка.
src/components/WorkReview.contextEvidence.test.tsx проверяет обе роли. Живые состояния
доступны в UI Kit; перед выпуском проверяются 320/390/540 px и реальные ролевые
проекции с production CSS. Полный npm run check обязателен; тесты формы не доказывают
смысловую корректность цитаты.

## Согласование {#authorization}

Основание — прямой текущий запрос родителя о сверке и исправлении заданий, а также
ранее данное указание привязать карточки к графу и UI Kit. Эти изменения закрывают
найденные дефекты проверки; согласованное школьное назначение не расширяется.
