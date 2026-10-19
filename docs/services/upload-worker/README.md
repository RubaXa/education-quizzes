---
id: service.upload-worker
status: accepted
implementation: partial
parent: product.education
uses:
  - module.materials.family-library
  - module.materials.storage-privacy
  - shared.data.firestore
sections: []
created: 2026-10-16
updated: 2026-10-19
consumers:
  - "shared educationEvents runtime"
  - "Education operator"
  - "photo/book upload request producer"
code:
  - "scripts/direct-upload-worker.mjs"
  - "scripts/install-upload-worker.mjs"
  - "packages/education-runtime/upload-broker.mjs"
---

# Локальный worker загрузок

Загрузки обрабатывает общий consumer единой очереди `educationEvents`; отдельный upload process и подписки на `dayOwners`, `dayUploads` или `bookUploads` не запускаются. `packages/education-runtime/upload-broker.mjs` экспортирует обработчики фото и семейных PDF для передачи в этот consumer и ограниченный reconciliation producer для старых клиентов. Producer читает не более одной страницы каждой активной source collection за запуск и публикует пропущенные события в `educationEvents`; он не слушает source documents. Он также восстанавливает подтверждённые, но ещё не разобранные старые источники (`pending` + `storage.state=stored` для фото, `needs-identification` + `storage.state=stored` для книг); `reviewed` и `linked` записи не публикуются. Переходы `requested → awaiting-upload`, `uploaded → pending/linked/needs-identification` сохраняют проверку актуальной семейной роли, исходного размера и хэша, публикацию/дедупликацию на Яндекс.Диске и семейную проекцию учебника. Финальные `upload.confirmed` и `material.ready` записываются в одном Firestore transaction с соответствующим завершённым source status.

`scripts/direct-upload-worker.mjs` — совместимый status/reconciliation wrapper, а не второй постоянно работающий worker: по умолчанию он печатает состояние управления через общий runtime, а `reconcile-once` выполняет только одну ограниченную проверку legacy источников. Reconciliation запускается runtime каждые 15 секунд, но за проход читает не больше одной страницы каждого типа; все пропущенные состояния попадают в основную очередь. `scripts/install-upload-worker.mjs` больше не устанавливает отдельный LaunchAgent и выводит команду установки единого runtime. При штатном `npm run telegram:install-worker -- --apply` новый Telegram worker подтверждает живую единственную подписку `educationEvents` по записи собственного PID в `worker.jsonl`; только затем installer выгружает старый `com.petr.education.upload-worker` и переносит plist в `.plist.disabled`. Timeout readiness оставляет legacy agent включённым; старые release/assets и secrets не удаляются. Секреты и бинарные файлы не попадают в Firestore или Git. Установка и запуск единого consumer описаны в [event queue contract](../../modules/synchronization/event-queue.md).

| Код | Вход → результат | Контракт |
|---|---|---|
| `packages/education-runtime/upload-broker.mjs` | Queue event + staged Yandex Disk object → verified stored object and atomic completion receipt; bounded legacy-event producer | [Family library](../../modules/materials/family-library.md), [storage/privacy](../../modules/materials/storage-privacy.md), [event queue](../../modules/synchronization/event-queue.md) |
| `packages/education-runtime/upload-broker.test.mjs` | Link issuance, atomic final photo receipt and bounded compatibility producer | Vitest |
| `scripts/direct-upload-worker.mjs` | Operator status and one-shot bounded compatibility reconciliation; no source listener | [Event queue](../../modules/synchronization/event-queue.md) |
| `scripts/install-upload-worker.mjs` | Retired installer alias → actionable unified runtime command; never creates a second agent | [Event queue](../../modules/synchronization/event-queue.md) |
| `scripts/install-upload-worker.test.mjs` | Verifies the retired alias only directs to unified runtime installation | Vitest |
| `storage/family-book-upload.mjs` | family-book request → validated path and content fingerprint | [Family library](../../modules/materials/family-library.md) |
| `storage/direct-upload.mjs` | photo request → validated image upload contract | [Storage/privacy](../../modules/materials/storage-privacy.md) |
| `storage/yandex-disk.mjs` | authorized disk operation → remote object metadata/content | [Storage/privacy](../../modules/materials/storage-privacy.md) |
