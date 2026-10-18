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
**Статус:** family renderer and explicit outbox delivery adapter implemented; event grouping, team routing and approved contextual links are not implemented. Delivery stays disabled by default.

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

```text
📚 Изменения в Education · {время/период}

{имя ребёнка}
• {читаемый тип}: {предмет или задание}
  {подтверждённое новое значение или статус}
  {время события} · {контекстная ссылка, если доступна}
```

Пока это каркас, а не утверждённый дизайн. Renderer применяет event-specific field whitelist: оценка выводится только для `grade.*` и в формате `1–5` с опциональным знаком; произвольные `value`, quiz answer/status, upload status и closed review detail не выводятся. Team view пока содержит только категорию события. Не включать raw path, document ID, токены или ошибки SDK. Разбитые на части сообщения имеют заголовок `часть i/n`.

## Telegram formatting и частичные ошибки

Предпочитать plain text или безопасные entity-aware форматтеры; пользовательские значения должны экранироваться, а ссылки — проверяться по разрешённым host/path. Каждая часть дайджеста имеет отдельный outbox receipt. Если часть отправлена, а следующая упала, повторять только незавершённую часть; если API outcome неоднозначен — применять оговорку at-least-once из ledger spec.

Retry/rate-limit детали принадлежат [ledger/outbox](event-ledger-outbox.md). grammY и `@grammyjs/auto-retry` применяются в Telegram adapter; plugin retry не заменяет устойчивую очередь.

## Будущие расширения

Подмодули `templates/<event-type>.md` добавлять, когда event catalog станет независимым. Настройки категорий, locale, buttons/actions и альтернативный transport — отдельные контракты, не включать их как скрытые условия в базовый renderer.
