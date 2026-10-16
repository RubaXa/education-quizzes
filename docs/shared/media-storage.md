---
id: shared.media-storage
status: accepted
implementation: partial
parent: product.education
uses:
  - module.materials
  - module.materials.storage-privacy
  - service.upload-worker
sections: []
---

# Общая граница медиа

Оригиналы работ и PDF хранятся на Яндекс.Диске; Firestore содержит метаданные, статусы, хэши и связи. Дедупликация общего оригинала не объединяет личные результаты и не создаёт новое семейное право.

| Контракт | Владелец деталей |
|---|---|
| [Хранение и приватность](../modules/materials/storage-privacy.md) | Передача фото, промежуточная очередь, разбор и миграция старых `dataUrl` |
| [Семейная библиотека](../modules/materials/family-library.md) | Собственное издание семьи и проекции общего каталога |
| [Upload worker](../services/upload-worker/README.md) | Выдача адреса и техническое подтверждение файла |
| [Архив семей](../modules/families/family-artifact-access.md) | Целевой шлюз, отзыв и аудит доступа; ограничения действующего пути |

Адаптеры находятся в `storage/yandex-disk.mjs`, `storage/direct-upload.mjs`, `storage/family-book-upload.mjs`; клиентская очередь — `src/lib/photoOutbox.ts`. Результат технической передачи не равен подтверждённому выполнению учебного задания.
