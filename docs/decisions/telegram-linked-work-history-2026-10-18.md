---
id: decision.telegram-linked-work-history-2026-10-18
status: accepted
implementation: implemented
created: 2026-10-18
updated: 2026-10-18
parent: shared.design.telegram
uses:
  - service.telegram-bot.work-history
  - service.telegram-bot.delivery
  - shared.design.ui-kit
consumers:
  - Telegram renderer
  - Education UI Kit
  - bot operator
code:
  - packages/telegram-notifications/adapters/work-history-firestore.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Сводка изменений и связанная история Telegram

## Основание

18.10 пользователь выбрал в чате сводку изменений и историю каждой конкретной работы, потребовал внедрение через Luna с проверкой техлидом, убрать кнопку UI Kit из уведомлений, обновить спецификации/тесты и согласовать общий выпуск с параллельной сессией.

## Было → стало

Ранее компактные сообщения показывали текущий статус отдельными несвязанными сводками. Теперь шапка содержит ребёнка и число изменений, общий предмет/дату один раз, точную работу, подтверждённый переход и короткую публичную причину/следующий шаг. Иконки кодируют постоянный смысл, не заменяя текст. Оценка не означает доказанное освоение навыка.

Upload/review одной проверенной day task получают общий непрозрачный workRef; другое задание, ребёнок, семья, исходный день или link изолированы. При freeze группа разделяется по фактическим предыдущим receipt messageId. Отправленные части фиксируют точные workRefs; receipt и указатели истории записываются в одной транзакции под fencing. Следующее изменение отвечает на соответствующее отправленное сообщение. Подробный контракт — [история работы](../services/telegram-bot/work-history.md).

UI Kit показывает тот же production VM на условных данных, включая последовательность загрузка → нужна правка → проверено. Кнопка UI Kit исключена из новых и повторных отправок; старые immutable payload не переписываются. Каталог остаётся на сайте. Нативный reply использует [ReplyParameters Telegram](https://core.telegram.org/bots/api#replyparameters) с allow_sending_without_reply:true; дополнительный send при неоднозначной ошибке не выполняется.

## Действия и роли

Родитель получает только разрешённые события своих детей по подтверждённой связи. Бот не проверяет работу, не вызывает LLM и не выдумывает причину. Оператор выпускает код, проверяет readiness и подтверждённую доставку отдельно от макета. Один владелец публикации согласовывает итоговый main с параллельной сессией.

## Проверки

Регрессии включают восстановление gate после429, partial receipts после перезапуска, атомарный отказ при подмене stream fence и новую link того же чата. Повторные загрузки одной exact workRef объединяются в одну строку с числом уникальных подтверждённых файлов; имена/даты не служат ключом. Перед выпуском обязательны deterministic source identity/previous fields, mixed reply targets, точные part bindings, receipt/restart/partial retry/concurrency/fairness, family/link isolation, legacy compatibility, transport без UI Kit, общая VM и mobile viewport. Независимая Luna повторно проверила актуальный код и тесты; техлид отдельно перечитал transactional freeze/receipt и проверил, что stale review выводы сняты по фактическому тесту новой link. Мобильный viewport320/390/540px: короткая сводка233/191/174px, шрифт16px, без горизонтального overflow и внешних запросов. Полная проверка проекта и итоговый внешний readback фиксируются после исполнения; этот документ не объявляет локальный код выпущенным.

## Согласование

Прямой запрос пользователя18.10.2026: «берём сводку изменений и связанную историю каждой работы». Другая сессия первой выпустила auth PR18, затем передала право общего publish/install этой сессии. Её пользовательский auth-инцидент остаётся открытым; Telegram increment не объявляет его исправленным.

### Затронутые файлы

- `packages/education-presentation/notification.mjs`
- `packages/telegram-notifications/adapters/firestore.mjs`
- `packages/telegram-notifications/adapters/source-firestore.mjs`
- `packages/telegram-notifications/adapters/source-mesh.mjs`
- `packages/telegram-notifications/adapters/telegram.mjs`
- `packages/telegram-notifications/adapters/work-history-firestore.mjs`
- `packages/telegram-notifications/application/source-pipeline.mjs`
- `packages/telegram-notifications/domain/diff.mjs`
- `packages/telegram-notifications/domain/events.mjs`
- `packages/telegram-notifications/domain/renderer.mjs`
- `scripts/check-telegram-preview-viewport.mjs`
- `scripts/telegram-design-preview.mjs`
- `src/components/TelegramNotificationPreview.css`
- `src/components/TelegramNotificationPreview.tsx`
