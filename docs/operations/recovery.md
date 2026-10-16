---
id: operations.recovery
status: accepted
implementation: partial
parent: operations
uses:
  - service.operator-cli
  - service.upload-worker
  - module.synchronization.change-detection-and-reconciliation
sections: []
created: 2026-10-16
updated: 2026-10-16
consumers:
  - "sync operator"
  - "upload worker operator"
  - "review operator"
code:
  - "operator/run-operation.mjs"
  - "sync/publication-audit.mjs"
---

# Восстановление после сбоя

Источник, передача файла, операторская публикация и педагогическая проверка восстанавливаются в своих границах. Не очищать последний полный снимок, личные попытки или подтверждённый результат из-за сетевого сбоя.

| Граница | Порядок |
|---|---|
| МЭШ | Сохранить последний полный снимок и его возраст; повторить чтение с ограниченной частотой, сверить полноценный новый snapshot |
| Фото/Диск | Сверить файл и upload status; upload worker повторяет техническую передачу, закрытый исходник остаётся на устройстве до подтверждения |
| Операторская запись | Прочитать receipt и текущую ревизию, выполнить readback; неизвестный outcome не является разрешением слепо повторить публикацию |
| Педагогическая проверка | Перечитать все ожидающие фото, владельца, task/revision; `processing` и его возраст не заменяют атомарный захват |

Точные условия заданы в [контракте сверки](../modules/synchronization/change-detection-and-reconciliation.md), [CLI](../services/operator-cli/README.md) и [хранении](../modules/materials/storage-privacy.md). Для Telegram recovery/outbox пока описаны как целевой механизм, не действующий runbook.
