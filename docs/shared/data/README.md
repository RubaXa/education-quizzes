---
id: shared.data
status: accepted
implementation: partial
parent: product.education
uses:
  - module.families
  - module.school-diary
  - module.synchronization
  - module.assessments
  - module.reviews
  - module.materials
sections:
  - data-contracts

created: 2026-10-16
updated: 2026-10-17
consumers:
  - "Firestore publisher"
  - "web-app data readers"
  - "sync operator"
  - "schema implementer"
code:
  - "day/data-contract.mjs"
---

# Общие схемы данных

Этот shared contract задаёт общий язык документов Firestore, владельцев записи и ревизионную границу. Домены остаются владельцами содержания; общий слой фиксирует форму, происхождение, доступ и чтение опубликованных представлений.

Подключение серверного процесса к Firestore и проверка локального ADC выполняются общим [Education server runtime](../server-runtime.md#границы-и-порты). Это инфраструктурная граница: она не меняет схему данных, правила публикации, семейную авторизацию или подсчёт оплачиваемых reads.

| Код | Вход → результат | Контракт |
|---|---|---|
| [`day/data-contract.mjs`](../../../day/data-contract.mjs) | команда и входной пакет → проверенный day payload | [Firestore model](firestore.md) |
| [`src/lib/dayStore.ts`](../../../src/lib/dayStore.ts) | опубликованный день → клиентская модель дня | [Firestore model](firestore.md), [revisions](revisions.md) |
| [`sync/day-source-revision.mjs`](../../../sync/day-source-revision.mjs) | исходные снимки → устойчивый fingerprint/revision | [Revisions](revisions.md) |
| [`scripts/firestore-read-index.mjs`](../../../scripts/firestore-read-index.mjs) | source-level Firestore calls → проверяемый read-site inventory | [Firestore model](firestore.md) |

## Data contracts

- [Firestore model](firestore.md) — коллекции, вложенные сущности, владение и совместимость.
- [Revision matrix](revisions.md) — кто повышает ревизию, когда она меняется и что читает экран.
