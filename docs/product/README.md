---
id: product.education
status: accepted
implementation: partial
uses:
  - product.families
  - product.school-day
  - product.homework-review
  - product.assessments
  - product.olympiad-preparation
  - product.materials
  - module.families
  - module.school-diary
  - module.synchronization
  - module.reviews
  - module.assessments
  - module.materials
  - product.notifications
  - service.web-app
  - service.operator-cli
  - service.telegram-bot
  - service.upload-worker
  - shared.data
  - shared.design
sections:
  - возможности
  - сервисы-и-общие-контракты
  - предыдущий-полный-индекс-и-таблица-состояния

created: 2026-10-08
updated: 2026-10-16
consumers:
  - "parent"
  - "student"
  - "web-app frontend"
  - "Education operator"
code:
  - "src/App.tsx"
---

# PETR Education: продуктовый контракт

Education помогает семье видеть учебный день, подтверждённые задания и результаты, передавать материалы, проверять работы и получать уведомления. Нормативный корень — этот документ; нижележащие пользовательские сценарии, сервисы и модули уточняют границы и поведение. Датированные решения, исследования и аудиты являются основаниями или историей, а не самостоятельными действующими правилами.

## Возможности

| Область | Контракт |
|---|---|
| Семья и доступ | [Семейный сценарий](families.md) |
| Школьный день | [Расписание, ДЗ и оценки](school-day.md) |
| Синхронизация | [Синхронизация и планы](../modules/synchronization/README.md) |
| Домашняя работа и проверка | [Проверка работ](homework-review.md) |
| Оценивание и самопроверки | [Самопроверки](assessments.md) |
| Подготовка к олимпиадам | [Проект сценария и состояния реализации](olympiad-preparation.md) |
| Материалы и источники | [Материалы](materials.md) |
| Уведомления | [Встроенный inbox](../modules/notifications/inbox.md) и [Telegram-контракт](notifications.md) |

## Сервисы и общие контракты

| Узел | Назначение |
|---|---|
| [Web app](../services/web-app/README.md) | Клиентская оболочка Education; implementation не означает production deployment. |
| [Operator CLI](../services/operator-cli/README.md) | Повторяемые локальные операции и контролируемая публикация. |
| [Upload worker](../services/upload-worker/README.md) | Выдача адресов и техническое подтверждение файлов. |
| [Telegram bot](../services/telegram-bot/README.md) | Частично реализованный сервис уведомлений; source/runtime/linking и подтверждения эксплуатации см. в его спецификации. |
| [Общие данные](../shared/data/README.md) | Firestore и ревизии. |
| [Дизайн и компоненты](../shared/design/README.md) | Общие UI контракты и компоненты. |

## Предыдущий полный индекс и таблица состояния

[Полный индекс, сохранённый как аудит 16.10.2026](../audits/product-spec-index-2026-10-16.md).
