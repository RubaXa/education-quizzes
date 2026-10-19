---
id: module.synchronization
status: accepted
implementation: partial
parent: product.education
uses:
  - module.school-diary
  - module.materials
  - shared.data.firestore
sections:
  - код-и-данные
  - спецификации

created: 2026-10-16
updated: 2026-10-16
consumers:
  - "Education sync operator"
  - "sync-project CLI"
  - "Firestore publisher"
code:
  - "scripts/sync-project.mjs"
---

# Синхронизация и публикация

Разделяет получение источника, нормализацию, планирование и запись в Education. Только полный проверенный снимок может продвинуть baseline; подготовленная архитектура наблюдения не считается реализованным автономным процессом.

## Код и данные

| Код | Вход → результат | Контракт |
|---|---|---|
| [`sync/project-plan.mjs`](../../../sync/project-plan.mjs) | снимок и намерение → детерминированный план выполнения | [global-sync.md](global-sync.md) |
| [`day/pipeline-contract.mjs`](../../../day/pipeline-contract.mjs) | пакет дня → проверяемые барьеры публикации | [education-pipeline.md](education-pipeline.md) |
| [`day/build.mjs`](../../../day/build.mjs) | снимки и назначения → дневная модель | [plan-generation.md](plan-generation.md) |

## Спецификации

- [backend-driven-ui](backend-driven-ui.md)
- [change-detection-and-reconciliation](change-detection-and-reconciliation.md)
- [education-pipeline](education-pipeline.md)
- [execution-artifact](execution-artifact.md)
- [firestore-read-paths](firestore-read-paths.md)
- [global-sync](global-sync.md)
- [plan-generation](plan-generation.md)
- [shared-artifact-pipeline](shared-artifact-pipeline.md)
