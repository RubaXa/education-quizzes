---
id: module.notifications
status: accepted
implementation: partial
parent: product.education
uses:
  - module.school-diary
  - shared.data.firestore
  - service.telegram-bot
sections:
  - код-и-данные
  - спецификации

---

# События и inbox

Показывает подтверждённые обновления адресату и поддерживает квитанции прочтения. Наличие события не изменяет дневные данные и не означает, что работа выполнена.

## Код и данные

| Код | Вход → результат | Контракт |
|---|---|---|
| [`src/components/NotificationBell.tsx`](../../../src/components/NotificationBell.tsx) | личный inbox → счётчик и список обновлений | [inbox.md](inbox.md) |
| [`diary/application/school-alerts.mjs`](../../../diary/application/school-alerts.mjs) | снимок МЭШ → только подтверждённые школьные сигналы | [inbox.md](inbox.md) |

## Спецификации

- [inbox](inbox.md)
