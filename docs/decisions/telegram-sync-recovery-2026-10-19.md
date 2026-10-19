---
id: decision.telegram-sync-recovery-2026-10-19
status: accepted
implementation: partial
created: 2026-10-19
updated: 2026-10-19
parent: service.telegram-bot
uses:
  - service.telegram-bot.operations
  - service.telegram-bot.education-sync-dispatch
  - shared.server-runtime
consumers:
  - Education team
  - bot operator
code:
  []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Восстановление Telegram и запуск EducationSync

## Основание

Прямой запрос пользователя19.10: исправить зависание, подключить автозапуск EducationSync и доказать реальную доставку через Luna с проверкой техлида и выпуском main.

## Было → стало

Прямой запрос19.10: устранить повторное зависание, подключить автоматический EducationSync, доказать реальные Mesh notifications, реализовать через Luna с проверкой техлида и выпустить в main.

Было: PID/readiness показывали running/ready, но source и delivery не завершали операции больше часа; остановка зависла на source close, delivery drain и Firestore terminate. Запуск Codex был только исследован. Baseline не содержал timestamp успешного чтения.

Стало: active startup/source/delivery/dispatch deadlines ограничивают зависание и требуют завершения процесса для безопасной замены LaunchAgent. UTC telemetry и baseline observedAt дают различимые временные факты. Отдельный устойчивый dispatcher собирает natural Mesh events, адресует существующий EducationSync через официальный CLI и требует claim/heartbeat/complete. Read-only diagnostic проверяет natural ledger/outbox/digest receipts без синтетических учебных изменений.

## Действия и роли

Нет LLM в классификации/доставке уведомлений. Полная синхронизация переиспользует общий skill/CLI/runtime; новые семьи обнаруживаются registry без allowlist/cap. Первое наблюдение тихое, technical.probe/shadow не запускают workflow. Auth/owner/revocation, stable event IDs, delivery fences, история работы, компактная сводка и отсутствие кнопки UI Kit сохраняются. Дедупликация и подтверждение workflow отделены от факта queue acceptance. UI/Pages/Rules этим изменением не выпускаются.

## Проверки

Luna реализует крупные участки; техлид проверяет код и отрицательные сценарии. Отдельный transactional-store тест выявил принятие complete с истёкшим workflow lease; оно должно отклоняться. Проверяются фактический child-process exit до поздней записи, source/delivery/startup hanging, durable dedupe/coalescing, queue/claim races и retry, CLI/private file, receiptless sent и grouped receipt membership, since по detectedAt.

19.10 до установки нового кода source-check подтвердил93/93complete, natural delivery audit нашёл5новых событий (3grade.created, homework.changed и homework.assigned),0pending/retry,1уникальную Telegram receipt сводку. Эти события были реально обнаружены после operational restart, без изменения исходных МЭШ данных; более старые occurredAt не выдаются за новые школьные даты. Официальный codex queue получил ответ EDUCATION_SYNC_BRIDGE_CONNECTED от того же EducationSync чата. Полный automatic workflow/окончательный main release пока требуют отдельного readback после интеграции.


Затронутые файлы:

- `packages/telegram-notifications/adapters/config.mjs`.
- `packages/telegram-notifications/adapters/runtime.mjs`.
- `packages/telegram-notifications/adapters/worker-loop.mjs`.
- `scripts/telegram-bot.mjs`.
- `packages/telegram-notifications/application/source-pipeline.mjs`.
- `packages/education-runtime/telemetry.mjs`.
- `packages/telegram-notifications/operations/launch-agent.mjs`.
- `packages/telegram-notifications/operations/private-logger.mjs`.
- `scripts/telegram-runtime.mjs`.
- `packages/telegram-notifications/application/education-sync-dispatcher.mjs`.
- `packages/telegram-notifications/operations/mesh-delivery-check.mjs`.
- `packages/telegram-notifications/operations/operation-deadline.mjs`.
- `scripts/education-sync-dispatch.mjs`.

## Согласование

Пользователь явно разрешил реализацию через Luna, тесты, спецификации, согласованный merge/push в main и постоянный запуск на Mac. Соседняя сессия «Сравнить клиенты МЭШ» подтверждает отдельное владение Pages; здесь владелец Telegram install и bridge activation — техлид этого чата. Тесты и реальная доставка проверяются отдельно; частичный результат не объявляется полным выпуском.

Реальный запуск выявил отдельную бизнес-блокировку: auto-review требует разрешение на конкретный перенос вложения на Диск. Вместо повторного полного sync каждую минуту добавлены fenced block с конечной причиной и explicit resume; новые поколения сохраняются, Telegram не блокируется. Удалены альтернативные неиспользуемые unfenced acknowledgement API. Regression проверяет отсутствие повторного dispatch, coalescing новых событий в blocked и стабильный request ID после явного resume. Это исправление наблюдённого lifecycle, не доказательство завершения заблокированной публикации.

Последнее прямое уточнение пользователя19.10: стандартная синхронизация подтверждённых материалов МЭШ и размещение в его каталоге Яндекс.Диска должны выполняться постоянно, без повторного вопроса по каждому вложению. Точный спорный файл/destination/public link были представлены и разрешены. Автоматическая проверка действий внешнего инструмента не становится продуктовым ограничением или произвольным ручным gate Education; новые полномочия/назначения и технические проверки доступа не выдумываются.
