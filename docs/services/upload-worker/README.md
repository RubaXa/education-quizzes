---
id: service.upload-worker
status: accepted
implementation: implemented
parent: product.education
uses:
  - module.materials.family-library
  - module.materials.storage-privacy
  - shared.data.firestore
sections: []
created: 2026-10-16
updated: 2026-10-16
consumers:
  - "upload worker process"
  - "Education operator"
  - "photo/book upload request producer"
code:
  - "scripts/direct-upload-worker.mjs"
---

# Локальный worker загрузок

`direct-upload-worker.mjs` — long-running локальный broker для заявок на фото и семейные PDF. Это отдельный runtime от PWA. Он слушает Firestore-заявки, проверяет активную сессию/связь родителя с ребёнком, получает объект с Яндекс.Диска, проверяет заявленные размер и хэш, дедуплицирует учебник и записывает только метаданные/состояние. Для фото используются отдельные проверки upload contract. Секреты и бинарные файлы не должны попадать в Firestore или Git. Worker реализован как локальный процесс; это не утверждение о hosted/production deployment.

| Код | Вход → результат | Контракт |
|---|---|---|
| `scripts/direct-upload-worker.mjs` | Firestore upload request + staged Yandex Disk object → verified stored object and status receipt | [Family library](../../modules/materials/family-library.md), [storage/privacy](../../modules/materials/storage-privacy.md) |
| `storage/family-book-upload.mjs` | family-book request → validated path and content fingerprint | [Family library](../../modules/materials/family-library.md) |
| `storage/direct-upload.mjs` | photo request → validated image upload contract | [Storage/privacy](../../modules/materials/storage-privacy.md) |
| `storage/yandex-disk.mjs` | authorized disk operation → remote object metadata/content | [Storage/privacy](../../modules/materials/storage-privacy.md) |
