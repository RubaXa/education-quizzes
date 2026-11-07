---
id: decision.telegram-result-blocks-2026-11-07
status: accepted
implementation: implemented
created: 2026-11-07
updated: 2026-11-07
parent: shared.design.telegram
uses:
  - service.telegram-bot.delivery
  - service.telegram-bot.work-history
consumers:
  - Telegram renderer
  - Education UI Kit
  - product change gate
code:
  - packages/education-presentation/notification.mjs
  - packages/telegram-notifications/adapters/firestore.mjs
  - packages/telegram-notifications/adapters/source-firestore.mjs
  - packages/telegram-notifications/application/source-pipeline.mjs
  - packages/telegram-notifications/domain/diff.mjs
  - packages/telegram-notifications/domain/events.mjs
  - packages/telegram-notifications/domain/renderer.mjs
  - scripts/check-telegram-preview-viewport.mjs
  - src/components/TelegramNotificationPreview.css
  - src/components/TelegramNotificationPreview.tsx
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Смысл результата и блоки работ в Telegram

## Основание

07.11 родитель отверг «Проверено», «Часть подтверждена», цветные кружки без объяснения, отдельные сообщения одной минуты и общую кнопку дня. После интерактивного сравнения одобрил рекомендацию «По работе в блоке» и потребовал смешанный итог: верно/неверно/неполный ход в одной сводке. Это уточнение заменяет композицию reply из решений18.10; история и права сохраняются.

## Было → стало

Один статус без вывода → публичные answer/argument и confirmed/focus проходят всю цепочку allowlist, semantic fingerprint и renderer. Одна проверка — blockquote с жирным названием, результатом словами и короткой причиной; общие ребёнок/предмет/срок вынесены один раз. Цвет quote задаёт Telegram. Произвольный CSS не используется. Неясное остаётся неизвестным; верный ответ при неполном объяснении не становится зачётом.

30секунд тишины и последующее разделение по старым reply → единое окно60секунд от первого приёма, единый renderer группы без reply. Пределы объёма и безопасная изоляция сохраняются. Общая кнопка «Открыть день» в новых частях отсутствует; старые immutable части исполняются без переписывания. Фото receipt содержит число файлов для проверки, но не доказывает начало проверки.

Baseline review v3 тихо обогащает v2 без исторической рассылки; совместимый hash сохраняет реальные изменения старых полей при миграции. После миграции изменения новых безопасных выводов также создают событие. checkedAt-only остаётся тихим.

## Действия и роли

Только публичная learner-facing проекция dayProgress; приватные решения, критерии и исходные фотографии в Telegram не копируются. Документы семьи, зачёты и прежние попытки не изменяются. Учебная ошибка, неполное доказательство и техническое ожидание различаются. Membership, stream fencing, immutable parts и адресные receipts остаются обязательными. Подготовка/локальные тесты отдельно от выпуска PWA/runtime и фактического Telegram отображения.

Затронутые файлы:

- `packages/education-presentation/notification.mjs`
- `packages/telegram-notifications/adapters/firestore.mjs`
- `packages/telegram-notifications/adapters/source-firestore.mjs`
- `packages/telegram-notifications/application/source-pipeline.mjs`
- `packages/telegram-notifications/domain/diff.mjs`
- `packages/telegram-notifications/domain/events.mjs`
- `packages/telegram-notifications/domain/renderer.mjs`
- `scripts/check-telegram-preview-viewport.mjs`
- `src/components/TelegramNotificationPreview.css`
- `src/components/TelegramNotificationPreview.tsx`

## Проверки

Полная source→pipeline→domain→HTML фикстура воспроизводит потерю результата и проверяет восстановление без privateAnswer. Смешанные исходы, экранирование, неизвестные данные, безопасная клавиатура старых частей, один digest при разных прежних messageId, размерные части/restart/receipts, revoke и child isolation. UI Kit:320/390/540px, короткие/длинные/отсутствующие контексты, нормальный шрифт и отсутствие внешних запросов. Обязательны npm run check и отдельный browser viewport gate перед выпуском.

## Согласование

Прямой ответ родителя07.11: «Да, мне нравится ... твоя рекомендация» и требование одного смешанного итога. Предыдущий запрос требовал понять результат из самого сообщения и группировать события одной минуты. Пересмотр не затрагивает назначенный МЭШ объём и не повышает самостоятельность/освоение.
