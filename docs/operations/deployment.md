---
id: operations.deployment
status: accepted
implementation: partial
parent: operations
uses:
  - service.web-app
  - service.upload-worker
  - service.telegram-bot
  - product.pwa
sections: []
created: 2026-10-16
updated: 2026-10-16
consumers:
  - "release operator"
  - "upload worker operator"
  - "web-app users"
code:
  - "scripts/build-site.mjs"
  - "scripts/install-upload-worker.mjs"
---

# Выпуск приложений и правил

Статический интерфейс Education собирается Vite и выпускается на GitHub Pages; данные публикуются в Firestore независимо от PWA. `npm run publish:pages -- --dry-run` показывает необходимость выпуска, обычный `publish:pages` использует проверенный build. Push `main` сам сайт не обновляет. Публикация Firestore Rules — отдельная операция.

Перед выпуском пройти штатные gates, проверить приватность исходной и сайт-ветки; реальные работы, токены и изображения материалов не входят в Git. Изменение исходников не считается deployment: выпуск должен подтвердить свой артефакт/адрес, а публикация данных — адресное обратное чтение.

Локальный upload worker устанавливается `npm run storage:install-worker` как LaunchAgent согласно [хранению](../modules/materials/storage-privacy.md); повторный ручной worker одновременно с ним не запускается. Установка после изменения кода отдельна от выпуска PWA.

Host, IAM и secrets будущего Telegram worker остаются открытыми. Его нельзя объявлять работающим по наличию npm-зависимостей или спецификации; [операционный контракт](../services/telegram-bot/operations.md) задаёт условия первого запуска.
