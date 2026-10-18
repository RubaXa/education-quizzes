---
id: decision.telegram-compact-digest-2026-10-18
status: accepted
implementation: implemented
created: 2026-10-18
updated: 2026-10-18
parent: shared.design.telegram
uses:
  - service.telegram-bot.delivery
  - shared.design.ui-kit
consumers:
  - Telegram renderer
  - Education UI Kit
  - product change gate
code:
  - packages/education-presentation/notification.mjs
  - packages/telegram-notifications/domain/renderer.mjs
  - packages/telegram-notifications/adapters/telegram.mjs
  - src/components/TelegramNotificationPreview.tsx
  - src/components/TelegramNotificationPreview.css
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Компактная сводка Telegram

## Основание

18.10 родитель сообщил, что уведомления Telegram выглядят как отдельные большие карточки с повторяющимися заголовками и разделителями, а серия повторных уведомлений о проверке не добавляет полезной информации. Реальный просмотр выявил отличие UI Kit от production-сообщения. Приоритет — короткое понятное изменение, которое можно прочитать в обычном чате.

## Было → стало

Production renderer и UI Kit используют один `getNotificationDigestPresentation(events)`. Модель формирует обычный HTML `sendMessage` текст с одной короткой шапкой ребёнок/предмет и строками подтверждённых событий. Для проверки каждая строка использует символ статуса, точное название задания и короткую подпись статуса; значения, даты и контекст включаются только когда нужны. Повторяющийся event headline, шапка Education, rich heading, divider и footer убраны.

Названия заданий не заменяются общим «Проверка работы». Для `review.changed` без точного задания и подтверждённого статуса digest не выпускает строку; если строк не осталось, событие не создаёт пустое статусное сообщение. Длинные имена и названия не обрезаются в preview и переносятся в доступной ширине.

### Границы

Нативный рендер Telegram задаёт клиент: приложение не обещает произвольный CSS, фирменный hex или точное совпадение пикселей. Preview выводит production text при обычном размере 16px, с жирной короткой шапкой и переносом длинных названий; его CSS остаётся демонстрацией с общими semantic tokens. Символ статуса сопровождается подписью и не полагается только на цвет. Изменение формы уведомления не меняет факты, источники, роли и семейный доступ.

## Действия и роли

Семейный пользователь видит короткую сводку подтверждённых изменений; родители/опекуны сохраняют прежний авторизованный доступ. UI Kit показывает только условные данные, не отправляет сообщения и не выполняет семейных чтений. Production renderer формирует digest по общей ViewModel; оператор отвечает за локальный release и реальную проверку в подтверждённом чате.

## Проверки

Добавлены регрессии на точные три короткие строки, длинные имена и названия, перенос в 320 CSS px и исключение контекстной пустой проверки. Browser gate проверяет обычный font-size16px/font-weight400, bold header, отсутствие overflow и высоту короткого digest не более200px на390/540 и240px на320. Последний run: 320px short191px / long360px / no-context omitted; 390px short170px / long296px / no-context omitted; 540px short110px / long195px / no-context omitted. Production использует ту же ViewModel; полный release/check и фактический Telegram просмотр остаются отдельными gate-ами. Реализация в локальном дереве не означает выпуск или публикацию.

## Согласование

Компактный digest реализуется по прямому указанию родителя18.10. Смысловая модель статусов и границы подтверждённых данных сохраняются. Технический выпуск и Telegram-публикация не входят в статус локальной реализации.

### Затронутые файлы

- `packages/education-presentation/notification.mjs`
- `packages/telegram-notifications/adapters/firestore.mjs`
- `packages/telegram-notifications/adapters/source-firestore.mjs`
- `packages/telegram-notifications/adapters/telegram.mjs`
- `packages/telegram-notifications/application/notifications.mjs`
- `packages/telegram-notifications/application/source-pipeline.mjs`
- `packages/telegram-notifications/domain/events.mjs`
- `packages/telegram-notifications/domain/renderer.mjs`
- `packages/telegram-notifications/operations/readiness.mjs`
- `packages/telegram-notifications/operations/review-check.mjs`
- `scripts/check-telegram-preview-viewport.mjs`
- `scripts/telegram-design-preview.mjs`
- `scripts/telegram-runtime.mjs`
- `src/components/TelegramNotificationPreview.css`
- `src/components/TelegramNotificationPreview.tsx`

### Реализация и обнаруженные границы

Семейные группы устойчивы к перезапуску: durable pointer/group, окно30с тишины/60с максимального возраста, атомарный freeze в immutable outbox; максимум50событий/256KiB на группу,6строк/1200символов на часть. Отозванная link и разные дети не объединяются. Прежние pending v1/v2 и technical.probe сохраняют исходные части.

Независимая Luna и техлид дополнительно исправили ложное присвоение общего предмета при null, повтор предмета в оценках, голодание due queue, повторный рендер probe/legacy и ошибочный подсчёт общих receipts. Fingerprint review учитывает новый результат при прежнем статусе, а event передаёт только явный marker обновления; timestamp/context-only остаются тихими. Конкретная реализация группировки не устраняет неопределённый исход между Telegram send и записью receipt.

Read-only live сверка18.10:43review scopes,35с точным контекстом,1source-material отдельно,7с пробелом контекста (5task_not_in_page,2task_id_missing). Для последних отправка пустого статуса запрещена; baseline не продвигается.12сегодняшних прежних событий имеют sent receipts,2same-status revisions с неизвестной причиной. Это не доказательство полной доставки всех типов событий. Три реальных outbox query preflight прошли; построение дополнительного scoped индекса и фактические deployment/Telegram receipts проверяются при выпуске.

- `packages/telegram-notifications/domain/diff.mjs`

До выпуска техлид воспроизвёл ещё один дефект: `scripts/build-inputs.mjs` не учитывал packages/day, хотя UI импортирует общую модель; поэтому сборка могла пропустить новое оформление. Реестр inputs расширен, `scripts/build-inputs.test.mjs` проверяет invalidation shared code и игнорирование tests. [Контракт](../product/pwa.md#release-build).
