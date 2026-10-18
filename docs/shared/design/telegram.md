---
id: shared.design.telegram
status: accepted
implementation: implemented
created: 2026-10-18
updated: 2026-10-18
parent: shared.design
uses:
  - shared.design.statuses
  - shared.design.ui-kit
  - service.telegram-bot.delivery
consumers:
  - Telegram renderer
  - Education UI Kit
  - notification implementer
code:
  - packages/education-presentation/notification.mjs
  - scripts/check-telegram-preview-viewport.mjs
  - scripts/telegram-design-preview.mjs
  - src/components/TelegramNotificationPreview.css
  - src/components/TelegramNotificationPreview.tsx
sections:
  - назначение
  - визуальная-система
  - совместимость-и-безопасность
  - приёмка
---
# Уведомления Education в Telegram

## Назначение

Прямой запрос18.10: внедрить через Luna оформление, связанное с общей дизайн-системой; добавить шаблоны UI Kit, отправить настоящие примеры в подтверждённый чат, проверить, обновить спецификации и выпустить main. Новый дизайн не меняет учебные факты или правила авторизации.

## Визуальная система

Чистая общая модель представления используется renderer и UI Kit. Общий словарь статусов содержит смысл, подпись, tone, Lucide name и Telegram fallback symbol; сайт использует существующие CSS токены, Telegram — нативные стили клиента. Произвольный CSS/точный фирменный hex в Telegram не обещается. Фото получено означает waiting, проверенное выполнение — complete; учебная ошибка и технический сбой различаются. Заголовок конкретного события, ребёнок/предмет, акцент названия задания/значения, понятная русская дата и отдельный статус образуют одну иерархию. Большая повторяющаяся шапка Education исключается. Основное действие — адресный переход только при доказанном безопасном контексте.

Rich Messages используют структурные blocks: heading, paragraph, footer/divider и native buttons, где уместно. Цвет всегда сопровождается формой и подписью. Нативный Telegram fallback использует ⚪ neutral / 🟣 accent / 🔵 waiting / 🟢 success / 🟠 attention / 🔴 error; подпись сохраняет смысл, Lucide на сайте сохраняет форму состояния. Демонстрационный headline начинается с «Пример ·», включая уведомление на закрытом экране. Текстовые HTML сообщения — явный совместимый fallback, а не второй словарь. UI Kit показывает реальные модели шаблонов и состояния на условных данных, помечает симуляцию Telegram; CSS страницы не является обещанием точного рендера мессенджера. Шаблоны: upload, grade, homework, review, quiz, schedule, technical; длинные данные и отсутствие контекста предусмотрены. Служебный демонстрационный пример явно подписан, не выдаётся за новую оценку ребёнка.

## Совместимость и безопасность

Durable outbox сохраняет неизменяемые части сообщения и их формат. Persisted keyboard DTO плоский: buttons=array maps; вложенная матрица inline_keyboard строится только transport адаптером. Версия1 с текстовыми parts остаётся исполнимой; версия2 структурирована и строго валидируется перед каждой отправкой. Receipt/retry/restart/membership/channel проверки общие. Rich API fallback допустим только после однозначного отказа без отправки: сетевой timeout/500 не превращается в немедленную повторную отправку другим методом. Неподтверждённые ссылки, raw source URL, disk path, токены, ответы и приватный payload не отображаются. Канонический маршрут приложения выбирает контекст, авторизация приложения отдельно проверяет родителя; preview не даёт доступа к чужой семье.

## Приёмка

Тесты общего словаря, всех event templates, экранирования/инъекций, русских дат, длины/Unicode, неподдерживаемой схемы, v1 compatibility, частичных receipts и retry; UI Kit без семейных чтений и сетевой отправки, 320/390/540px; полный check. Реальные примеры идут только в уже подтверждённый пользовательский чат, с явной demo подписью и результатом Telegram API. Runtime устанавливается постоянным Mac сервисом, UI Kit публикуется на сайт. Реальные4примера отправлены18.10 нативным sendRichMessage,4receipts подтверждены; приёмка и границы — [решение итерации](../../decisions/telegram-design-system-2026-10-18.md). Статус окончательного выпуска UI Kit фиксируется там же.

Основание возможностей: [Rich Messages](https://core.telegram.org/bots/features#rich-messages), [Bot API](https://core.telegram.org/bots/api#sendrichmessage), проверено18.10.2026. Наличие метода в документации отдельно от фактической доступности API/отображения клиента.
