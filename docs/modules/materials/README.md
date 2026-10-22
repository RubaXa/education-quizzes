---
id: module.materials
status: accepted
implementation: partial
parent: product.education
uses:
  - module.families
  - shared.data.firestore
sections:
  - код-и-данные
  - спецификации

created: 2026-10-16
updated: 2026-10-16
consumers:
  - "parent"
  - "student"
  - "family library"
  - "upload worker"
code:
  - "src/components/FamilyLibrary.tsx"
---

# Материалы и учебные источники

Связывает семейные материалы, задания и страницы с конкретной семьёй/ребёнком. Общий архив дедуплицирует содержимое, но не создаёт семье неподтверждённый доступ.

## Код и данные

| Код | Вход → результат | Контракт |
|---|---|---|
| [`src/lib/materialRequest.ts`](../../../src/lib/materialRequest.ts) | запрос неизвестного источника → проверенное состояние уточнения | [material-clarification.md](material-clarification.md) |
| [`scripts/direct-upload-worker.mjs`](../../../scripts/direct-upload-worker.mjs) | заявка и файл → проверенный объект хранения | [storage-privacy.md](storage-privacy.md) |

## Спецификации

- [audio-library](audio-library.md)
- [family-library](family-library.md)
- [material-clarification](material-clarification.md)
- [materials](materials.md)
- [storage-privacy](storage-privacy.md)
