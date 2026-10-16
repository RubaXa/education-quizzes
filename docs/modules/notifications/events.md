---
id: module.notifications.events
status: accepted
implementation: partial
parent: module.notifications
uses:
  - module.notifications.inbox
  - service.telegram-bot.ports-and-events
sections:
  - расширение

created: 2026-10-16
updated: 2026-10-16
consumers:
  - "notification publisher"
  - "in-app inbox"
  - "Telegram service implementer"
code:
  - "storage/inbox-notifications.mjs"
---

# Каталог событий: действующий inbox и целевой Telegram

Это карта границ существующих и проектируемых событий. Единый channel-neutral event bus ещё не реализован; таблица не переименовывает существующие Firebase type values. Владелец действующих inbox полей — `InboxNotification` в `src/lib/educationSchema.ts`, producers — `storage/inbox-notifications.mjs`, `scripts/day.mjs`, `scripts/submissions.mjs`, `scripts/notifications.mjs` и `diary/application/school-alerts.mjs`.

| Действующий тип inbox | Подтверждённый смысл |
|---|---|
| `homework_published`, `homework_changed`, `homework_removed` | Опубликованное изменение ДЗ по источнику и ревизии |
| `grade_added`, `grade_changed` | Конкретная новая/изменённая школьная отметка |
| `school_late`, `school_remark` | Подтверждённое опоздание или замечание, не любой комментарий |
| `review_started`, `review_paused`, `review_ready`, `review_updated` | Состояние и результат проверки конкретной попытки |
| `parent_accepted`, `parent_reopened`, `parent_requirement_mandatory`, `parent_requirement_optional`, `parent_guidance` | Явное действие семьи по задаче/требованию |
| `product_update` | Отдельное уведомление о выпуске продукта |

`ActivityType` (`page_opened`, `test_started`, `submission_uploaded` и другие) — отдельный журнал действий; наличие типа не означает работающий автономный producer или семейную рассылку. Не смешивать activity, inbox и будущие domain events.

`notificationId(key)` вычисляет устойчивый inbox ID, `stageFamilyNotice` выбирает активные семейные связи и роли; политика повторной записи зависит от mode. Это действующая механика inbox, не Telegram outbox и не гарантия exactly-once.

## Расширение

Будущий Telegram использует отдельный [event envelope](../../services/telegram-bot/ports-and-events.md). Перед общим event catalog требуется явный mapping source/record/revision → факт → recipient view, проверка owner/privacy и совместимость существующих producers. Переиспользовать подтверждённую семантику, не копировать сырые документы и не считать одинаковое имя доказательством одинакового события.
