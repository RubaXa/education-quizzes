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

---

# Общие схемы данных

Этот shared contract задаёт общий язык документов Firestore, владельцев записи и ревизионную границу. Домены остаются владельцами содержания; общий слой фиксирует форму, происхождение, доступ и чтение опубликованных представлений.

| Код | Вход → результат | Контракт |
|---|---|---|
| [`day/data-contract.mjs`](../../../day/data-contract.mjs) | команда и входной пакет → проверенный day payload | [Firestore model](firestore.md) |
| [`src/lib/dayStore.ts`](../../../src/lib/dayStore.ts) | опубликованный день → клиентская модель дня | [Firestore model](firestore.md), [revisions](revisions.md) |
| [`sync/day-source-revision.mjs`](../../../sync/day-source-revision.mjs) | исходные снимки → устойчивый fingerprint/revision | [Revisions](revisions.md) |
| [`scripts/firestore-read-index.mjs`](../../../scripts/firestore-read-index.mjs) | source-level Firestore calls → проверяемый read-site inventory | [Firestore model](firestore.md) |

## Data contracts

- [Firestore model](firestore.md) — коллекции, вложенные сущности, владение и совместимость.
- [Revision matrix](revisions.md) — кто повышает ревизию, когда она меняется и что читает экран.
