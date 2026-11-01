---
id: decision.student-review-reply-2026-11-01
status: accepted
implementation: implemented
created: 2026-11-01
updated: 2026-11-01
parent: shared.design.student-review-step
uses:
  - module.synchronization.event-queue
  - shared.access-and-privacy
consumers:
  - "learner"
  - "parent"
  - "Education operator"
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Ответ в текущем шаге и «Непонятно»

## Основание

01.11.2026 родитель прямо потребовал понятный отклик после выбора/ввода и следующий
шаг по ответу, без готового решения. Также — «Непонятно» одним нажатием, возможность
написать текст и сохранить его для последующей обработки агентом.

## Было → стало

Локальная подсветка сохраняется до явной отправки. Ответ/вопрос теперь атомарно
попадает в существующую очередь с неизменяемым снимком текущего вопроса и собственной
записью. После проверки исполнитель публикует адресный отклик и один безопасный
следующий переход. Pending восстанавливается; ошибка не стирает ввод; retry имеет
тот же operationId. Дополнение сохраняет исходное сообщение. Старый запоздавший
отклик не обгоняет новый запрос того же шага. Версия проверки меняет корень диалога.
Следующий вопрос сохраняет нужный рисунок/схему через тот же diagram, а не требует
искать опору в истории. Закрытый критерий не передаётся браузеру; транспорт не вычисляет вердикт из выбора.

Затронутые файлы:
- `e2e/review-conversation.e2e.ts`
- `packages/education-presentation/review-reply.d.mts`
- `packages/education-presentation/review-reply.mjs`
- `packages/education-presentation/review-reply.test.mjs`
- `src/components/ReviewConversation.test.tsx`
- `src/components/ReviewConversation.tsx`
- `src/components/ReviewReplyControls.tsx`
- `src/lib/reviewConversation.ts`
- `src/ui-kit/ReviewConversationExample.tsx`
- `AGENTS.md`
- `firestore.rules`
- `scripts/firestore-rules-help-emulator.test.mjs`
- `scripts/help-response.mjs`
- `src/DayPage.tsx`
- `src/UiKit.test.tsx`
- `src/WeekendMathSlot.tsx`
- `src/components/PhotoHelpPanel.tsx`
- `src/components/ProblemTaskCard.tsx`
- `src/components/ReviewActivity.css`
- `src/components/ReviewActivity.tsx`
- `src/components/ReviewBrief.tsx`
- `src/components/ReviewBriefShowcase.tsx`
- `src/components/TaskGuidance.tsx`
- `src/components/WorkReview.tsx`
- `src/lib/dayGuidance.ts`
- `src/lib/dayStore.ts`
- `sync/event-task-artifact.mjs`
- `sync/help-response.mjs`
- `sync/help-response.test.mjs`

## Действия и роли

Student отправляет собственный ответ, «Непонятно» и необязательный текст. Родитель
видит разрешённую беседу без кнопок отправки. Исполнитель читает точный artifact,
проверяет собственную запись по микрошагу, выбирает correct/partial/retry/stuck/clarify
и проверяет новый вопрос на спойлер во всей проекции. Только сервер пишет отклик.
Оценка, исходная проверка, фото, закрытый путь, попытки и семейные решения не меняются.
Принятая работа нового действия не получает. Права ограничены прежним ребёнком и
заданием; новая запись без фото требует текущего question/activity и атомарного события.

## Проверки

Поведенческие тесты отправки, ошибки/retry, ожидания, ветки следующего шага, one-click
stuck и пояснения; исходный результат сохраняется. Emulator проходит реальный batch
request/history/event, адресный artifact, checked response и новую отправку, запрещает
подмену вопроса/версии/чужого этапа, запись отклика учеником и parent-send. UI Kit
использует те же компоненты с условным транспортом;320/390/540px, фокус, кнопки44px,
чистое поле и отсутствие дубля проверяются браузером. Выпуск и ученический live-view
подтверждаются отдельной закрытой квитанцией, не наличием этого решения.

## Согласование

Прямое поручение в текущем чате01.11.2026. Не создаются таймеры, новые тесты вместо
ответа на текущий вопрос или служебные сообщения между чатами Education.
