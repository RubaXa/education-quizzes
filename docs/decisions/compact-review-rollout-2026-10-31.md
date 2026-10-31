---
id: decision.compact-review-rollout-2026-10-31
status: accepted
implementation: implemented
created: 2026-10-31
updated: 2026-10-31
parent: shared.design.compact-review
uses:
  - shared.design.ui-kit
  - module.reviews.subject-aware-guidance
consumers:
  - "student"
  - "parent"
  - "review author"
  - "frontend developer"
code:
  - "src/UiKit.tsx"
  - "src/components/ParentTaskGuide.tsx"
  - "src/components/PhotoHelpRequest.tsx"
  - "src/components/QuizResultCard.tsx"
  - "src/components/TaskGuidance.tsx"
  - "src/components/WorkReview.tsx"
  - "src/education-design-tokens.css"
  - "src/lib/dayStore.ts"
  - "storage/review-projection.mjs"
  - "storage/tutoring-decision.mjs"
  - "packages/education-presentation/review-content.mjs"
  - "scripts/check-review-brief-viewport.mjs"
  - "src/components/QuizResultCard.css"
  - "src/components/ReviewBrief.css"
  - "src/components/ReviewBrief.tsx"
  - "src/components/ReviewBriefShowcase.tsx"
  - "src/components/ReviewTypography.css"
  - "src/components/WorkReview.css"
  - "src/lib/reviewBriefExamples.ts"
  - "src/lib/workReviewBrief.ts"
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Согласованный общий формат всех разборов

## Основание

После просмотра конкретного опубликованного разбора родитель31.10 прямо поручил:
«Исправь подсказку, чтобы она не выдавала ответ заранее, и внедряй этот формат для всех
разборов. Обнови инструкции, спецификации и UI Kit». Это одобрение показанной композиции
и поручение выпуска, а не очередной запрос только макета.

## Было → стало

Ранее отдельный кандидат UI Kit не менял работу сервиса. У письменной работы подряд шли
итог, несколько цитат с полными объяснениями и повторный вывод перед вопросом. У теста
использовалась другая высокая карточка. Теперь WorkReview и QuizResultCard используют
общий ReviewBrief и четыре типизированных представления; вопрос виден сразу, адресные
пояснения раскрываются отдельно. PhotoHelpRequest использует тот же компонент ответа,
а ParentTaskGuide/TaskGuidance сохраняют разрешённые этапы с общей ReviewTypography.

Все затронутые файлы:

- `src/UiKit.tsx`
- `src/components/ParentTaskGuide.tsx`
- `src/components/PhotoHelpRequest.tsx`
- `src/components/QuizResultCard.tsx`
- `src/components/TaskGuidance.tsx`
- `src/components/WorkReview.tsx`
- `src/education-design-tokens.css`
- `src/lib/dayStore.ts`
- `storage/review-projection.mjs`
- `storage/tutoring-decision.mjs`
- `packages/education-presentation/review-content.mjs`
- `scripts/check-review-brief-viewport.mjs`
- `src/components/QuizResultCard.css`
- `src/components/ReviewBrief.css`
- `src/components/ReviewBrief.tsx`
- `src/components/ReviewBriefShowcase.tsx`
- `src/components/ReviewTypography.css`
- `src/components/WorkReview.css`
- `src/lib/reviewBriefExamples.ts`
- `src/lib/workReviewBrief.ts`

`workReviewBrief` не вычисляет новый учебный вывод и не обрезает старую запись.
Доменная схема graphics/details одинакова у CLI и клиента. Старые шаги автоматически
раскладываются в соседние раскрытия при чтении; данные не переписываются массово.
Текст текущей подсказки исправляется адресной CLI-коррекцией с сохранением попыток.

## Действия и роли

Ученик получает только разрешённый публичный срез. Ответ на текущий вопрос не должен
содержаться и в закрытых аккордеонах этого среза. Полный ответ, критерий и будущие ветки
сохраняются у взрослого в закрытом документе. Хронология, баллы/пропуски, ожидание нового
файла, исходники, семейное принятие и переключатели обязательности сохраняют смысл.
Новых подписок, задач, тестов и учебных результатов формат не создаёт.

UI Kit использует реальные WorkReview и QuizResultCard, те же CSS/токены и синтетические
данные. Отдельный внешний вид только для каталога не поддерживается. Код вопроса и точный
источник остаются доступны. Готовое/принятое не создаёт новый вопрос; неизвестное не
становится ошибкой ученика. В работе с диктантом сохраняется разрешённый показ написания
после отправки, который не является подсказкой к открытому текущему вопросу.

## Проверки

До изменения RED WorkReview.compact.test.tsx воспроизвёл отсутствие общего компонента
и вопрос после объяснений для обеих ролей. После изменения проверяются общий рендер,
порядок вопроса/пояснений, история, принятое и pending-состояния, чтение буквальной записи,
статусы результатов, баллы и источник, доменный allowlist без закрытых ключей и отдельный
видимый bridge. Дополнительно — браузер320/390/540px, раскрытия, большой текст, обе роли,
реальная композиция задания. Команды: npm run check; node scripts/check-review-brief-viewport.mjs.
Сам по себе успешный тест не доказывает отсутствие педагогического спойлера: автор отдельно
читает весь ученический документ, а выпуск подтверждается main/PWA/runtime/readback.

## Согласование

`approved-mockup`: родитель прямо одобрил показанный компактный разбор и поручил внедрить
для всех разборов; согласована координация с активными чатами Education и один publisher.
Формат и доступ не дают права менять учебный вердикт или выдавать коррекцию авторского
текста за новую попытку. Публикация выполняется после обязательных проверок и актуального
main; наличие этого документа не является квитанцией deployment.
