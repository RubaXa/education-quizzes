---
id: service.telegram-bot.delivery
status: accepted
implementation: partial
created: 2026-10-16
updated: 2026-10-18
consumers:
  - "Telegram service implementer"
  - "bot operator"
  - "parents and guardians"
code:
  - "packages/telegram-notifications/domain/renderer.mjs"
  - "packages/telegram-notifications/application/notifications.mjs"
  - "packages/telegram-notifications/adapters/telegram.mjs"
parent: service.telegram-bot
uses:
  - service.telegram-bot
  - service.telegram-bot.ports-and-events
  - service.telegram-bot.event-ledger-outbox
  - shared.design.telegram
sections:
  - разделение-ответственности
  - маршрутизация
  - группировка-и-размер
  - структурный-вид
  - telegram-formatting-и-частичные-ошибки
  - будущие-расширения
---
# Маршрутизация, форматирование и Telegram доставка

**Родитель:** [корневая архитектура](README.md); [порты и события](ports-and-events.md); [ledger/outbox](event-ledger-outbox.md).
**Статус:** семейная доставка работает в постоянном Mac runtime. Принят общий [дизайн Telegram](../../shared/design/telegram.md): shared ViewModel, Rich Messages, HTML fallback, безопасная навигация и immutable outbox v2; фактический выпуск указан в решении итерации. Grouping и team routing остаются отдельными незавершёнными возможностями.

## Разделение ответственности

- Recipient resolver применяет проверенные identity links и тип аудитории.
- Policy решает, какие event types получает родитель и команда.
- Grouping собирает сообщения по получателю в окне 30 секунд тишины с жёстким пределом 60 секунд после первого события.
- Renderer — чистая детерминированная функция, формирующая Telegram-safe parts и допустимые context links.
- grammY adapter выполняет Telegram API вызовы и нормализует Telegram errors.

Адаптер доставки не выбирает детей/семьи, а renderer не читает Firestore и не вызывает сеть.

## Маршрутизация

- Родитель/опекун получает события по всем детям каждой активной семейной связи.
- Командный поток на первом запуске направлен Telegram account `@ibnrubaxa`; target должен быть конфигурационным и заменяемым на группу/служебный аккаунт.
- Прямые детские адресаты в MVP не создаются.
- Перед enqueue resolver проверяет active link; перед отправкой повторно проверяет состояние link, чтобы уже отозванная связь не получила отложенное сообщение.
- Приватные поля режутся по роли/`privacyClass`. Team summary и family summary — разные views, даже если event один.

## Группировка и размер

Собрать события по recipient и близкому времени; закрыть после 30 секунд тишины и отправить к 60 секундам от первого события. При превышении максимального возраста уже не продлевать группу. Сначала определить лимит безопасного текста ниже Telegram API limit, затем делить на связанные части с заголовком, номером части и сохранением порядка событий.

Каждый блок события по возможности включает: ребёнок, тип изменения, предмет/задание, новое значение/статус, время источника и понятный контекст/ссылка. Поле без подтверждённого значения опускается; его нельзя заменять догадкой. Поздние события после flush идут в следующую группу.

## Структурный вид

Общий [контракт оформления](../../shared/design/telegram.md) задаёт event headline, ребёнка/предмет, сильный заголовок задания или значение, русскую дату, самостоятельный статус и основное действие. Общая чистая модель и словарь статусов используются также StatusIcon и UI Kit; Telegram не получает CSS сайта. Нативные символы и темы клиента сохраняют смысл; точный фирменный цвет мессенджера не обещается.

`upload.confirmed` означает «Фото получено» и waiting «Ждёт проверки», не правильность работы. `review.changed` получает статус лишь из подтверждённого allowlisted review.status. `quiz.submitted` остаётся ожиданием проверки. `grade.*` выводит значение1–5 с опциональным знаком, не приписывает самостоятельное владение навыком. Поля, которых нет в подтверждённом событии, не выдумываются. Источники/ответы/приватные пути не выводятся.

Safe navigationContext приходит из подтверждённого Firestore day owner и exact task membership. Day token задаёт канонический ресурс, не роль или авторизацию; приложение проверяет участника семьи. Без доказанного контекста кнопки нет. Ссылка ведёт в день; task anchor без поддержки маршрута не придумывается. Демо-кнопка UI Kit разрешена только для явно помеченных демонстрационных сообщений и никогда не открывает семейные данные.

## Telegram formatting и частичные ошибки

Production renderer сохраняет структурные parts версии2: plaintext, безопасный HTML fallback, RichText/blocks и проверенную клавиатуру. RichText использует нативные объекты форматирования, HTML tags не вставляются в строки blocks. Каждая часть проходит общий schema validator перед отправкой. Fallback после однозначного отказа unsupported method возможен; timeout/429/5xx не вызывают немедленную повторную отправку другим методом. Пользовательский текст экранируется только при HTML сериализации, а ссылки проверяются по точному host/path/hash без credentials/query/port. Каждая часть дайджеста имеет отдельный outbox receipt. Если часть отправлена, а следующая упала, повторять только незавершённую часть; если API outcome неоднозначен — применять оговорку at-least-once из ledger spec.

Retry/rate-limit детали принадлежат [ledger/outbox](event-ledger-outbox.md). grammY и `@grammyjs/auto-retry` применяются в Telegram adapter; plugin retry не заменяет устойчивую очередь.

## Будущие расширения

Подмодули `templates/<event-type>.md` добавлять, когда event catalog станет независимым. Настройки категорий, locale и альтернативный transport — отдельные контракты, не включать их как скрытые условия в базовый renderer.
