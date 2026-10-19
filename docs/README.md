---
id: docs.education
status: accepted
implementation: not-applicable
created: 2026-10-16
updated: 2026-10-16
consumers:
  - "Education agent"
  - "developer"
code:
  []
parent: product.education
uses:
  - architecture.education
  - shared.specification-system
sections:
  - как-различать-документы
---

# Навигатор спецификаций Education

Начни с [продукта](product/README.md), если неизвестна цель изменения, или с [карты архитектуры](../ARCHITECTURE.md), если неизвестны сервис и граница данных. Затем открой только строку своей задачи и используемые ею контракты. [Карта файлов](file-map.md) связывает каждый файл с ближайшей спецификацией и потребителем.

| Задача | Первый контракт | Соседние границы |
|---|---|---|
| Семья, роли и подключение источника | [Families](modules/families/README.md) | [Доступ и приватность](shared/access-and-privacy.md), [модель данных](shared/data/firestore.md) |
| Дневник, расписание, ДЗ или оценки | [School diary](modules/school-diary/README.md) | [Synchronization](modules/synchronization/README.md), [Assignments](modules/assignments/README.md) |
| Полная ручная синхронизация | [Operator CLI](services/operator-cli/README.md) | [Порядок запуска](operations/education-sync.md), [глобальный охват](modules/synchronization/global-sync.md) |
| События действий, автоматический разбор, Telegram | [Единая очередь](modules/synchronization/event-queue.md) | [Готовое поручение](modules/synchronization/execution-artifact.md), [диспетчер](services/telegram-bot/education-sync-dispatch.md) |
| Новое поле/подписка Firestore | [Общие данные](shared/data/README.md) | [Ревизии](shared/data/revisions.md), [реестр чтений](modules/synchronization/firestore-read-paths.md) |
| Карточка, статус, экран или изображение | [Дизайн-система](shared/design/README.md) | [Компоненты](shared/design/components.md), [контроль UI](product/ui-change-control.md) |
| Фото/PDF или передача на Диск | [Материалы](modules/materials/README.md) | [Upload worker](services/upload-worker/README.md), [хранение](shared/media-storage.md) |
| Проверка работы или предметная помощь | [Reviews](modules/reviews/README.md) | [Основания проверки](modules/reviews/review-criteria-provenance.md), [статус задания](modules/assignments/README.md) |
| Тест, попытка или продолжение | [Assessments](modules/assessments/README.md) | [Граф самопроверок](modules/assessments/assessment-decision-graph.md) |
| Встроенный inbox | [Notifications](modules/notifications/README.md) | [In-app события](modules/notifications/inbox.md) |
| Telegram-бот | [Telegram service](services/telegram-bot/README.md) | [Продуктовые требования](product/notifications.md), [семья](modules/families/README.md) |
| Зависимости, установка, выпуск или восстановление | [Toolchain](shared/toolchain.md) | [Эксплуатация](operations/local-development.md), [выпуск](operations/deployment.md) |
| Новая/переносимая спецификация | [Правила графа](shared/specification-system.md) | [Шаблон](templates/specification.md), [карта файлов](file-map.md) |

## Как различать документы

`product/` описывает пользовательский результат; `services/` — исполняемые приложения/процессы; `modules/` — предметные контракты; `shared/` — общие данные, дизайн и технические правила; `operations/` — запуск и обслуживание. `decisions/` хранит основания решений, `research/` — исследования, `audits/` — датированные свидетельства, `plans/` — план изменений. Их `status` и `implementation` читаются независимо.

Быстрая `npm run check:docs` проверяет структуру, обязательные разделы и локальные ссылки; pre-commit выполняет её по Git index. Проверка `npm run check:spec` дополнительно валидирует ID, ссылки и якоря, отсутствие циклов родительства, предел 700 строк, карту файлов и UI-контракт. `npm run specs:generate` пересобирает [JSON-граф](generated/graph.json) и [Mermaid](generated/graph.mmd) из frontmatter и file-map. Эти результаты не редактируются вручную.
