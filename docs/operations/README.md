---
id: operations
status: accepted
implementation: partial
parent: product.education
uses:
  - service.operator-cli
  - service.upload-worker
  - service.telegram-bot
sections: []
---

# Операционная граница

Операции выполняются штатными entrypoint-ами с подтверждением результата и сохранением приватных данных. CLI core управляет синхронизацией; отдельный локальный загрузчик обслуживает файлы; Telegram worker пока остаётся целевой архитектурой без внедрённого runtime.

| Runtime / command | Операционный результат | Контракт |
|---|---|---|
| `scripts/day.mjs` и `scripts/sync-*.mjs` | повторяемая синхронизация и адресная проверка публикации | [Operator CLI](../services/operator-cli/README.md) |
| `scripts/direct-upload-worker.mjs` | непрерывная обработка заявок на фото и PDF | [Upload worker](../services/upload-worker/README.md) |
| `npm run check:spec` | проверка связей спецификаций/UI-контракта (после интеграции графового валидатора) | [Product root](../product/README.md) |
| Telegram bot | запуск/эксплуатация не готовы до выбора host/secrets/observability | [Telegram service](../services/telegram-bot/README.md) |
