---
id: decision.telegram-foundation
status: accepted
implementation: not-applicable
created: 2026-10-16
updated: 2026-10-16
parent: service.telegram-bot
uses:
  - service.telegram-bot
  - service.telegram-bot.operations
  - service.telegram-bot.identity-and-linking
  - service.telegram-bot.event-ledger-outbox
  - service.telegram-bot.ports-and-events
  - service.telegram-bot.delivery
consumers:
  - Пользователь, запросивший первый runtime increment
  - Worker Telegram-сервиса
  - Оператор локального запуска
  - Технический лидер
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Первый runtime increment Telegram-сервиса

## Основание

Пользователь прямо запросил начать реализацию Telegram-сервиса и сообщил о локально заданной переменной `AGI_EDU_BOT`. Значение токена не запрашивалось и не раскрывается. Решение фиксирует начальный технический срез и его границы, не объявляя полный сервис или выпуск.

## Было → стало

Реализованы базовые primitives: локальная конфигурация; проверка `getMe`; приватная регистрация аккаунта; подтверждённое отключение отдельной связи при наличии backend link; нормализованные domain events и canonical snapshot diff; transactional Firestore event ledger/outbox; lease fencing и recovery; durable receipts по частям; privacy-aware renderer; Telegram transport и bounded worker loop с остановкой по сигналу. `check` делает read-only запрос Telegram `getMe`; `worker` запускается явно, а delivery остаётся выключенной без `--enable-delivery`.

Решение и hash-record охватывают все 13 текущих runtime source paths: `packages/telegram-notifications/adapters/config.mjs`, `packages/telegram-notifications/adapters/firestore.mjs`, `packages/telegram-notifications/adapters/memory.mjs`, `packages/telegram-notifications/adapters/runtime.mjs`, `packages/telegram-notifications/adapters/telegram.mjs`, `packages/telegram-notifications/adapters/worker-loop.mjs`, `packages/telegram-notifications/application/identity.mjs`, `packages/telegram-notifications/application/notifications.mjs`, `packages/telegram-notifications/domain/diff.mjs`, `packages/telegram-notifications/domain/events.mjs`, `packages/telegram-notifications/domain/ports.mjs`, `packages/telegram-notifications/domain/renderer.mjs`, `scripts/telegram-bot.mjs`.

Остаются planned: реальные Firestore и МЭШ source observers/listeners с durable checkpoints, безопасный UI/issuer family-link token, grouping/digest policy, production IAM и deployment/rollout. Реальный Firestore registry/outbox write не проверялся; Firestore adapter tests используют FakeFirestore. Каждая атомарная claim увеличивает attempts, а истёкшая lease возвращается в `retry_wait` с короткой задержкой или переводится в `dead_letter` при исчерпании лимита. Тесты отдельно покрывают crash cap для memory и Firestore adapters. До production остаются проверка целевого Firestore/IAM и отдельный rollout.

## Действия и роли

Оператор может выполнить `npm run telegram:check` для read-only Bot API identity check либо явно запустить `npm run telegram:worker`. `AGI_EDU_BOT` считывается локально, его значение не записывается в код, decision, журнал или командный вывод. Worker требует `TELEGRAM_FIRESTORE_PROJECT_ID` и ADC. Авторизация семьи остаётся неразвёрнутой: этот increment не содержит реального UI/issuer для связи аккаунта с семьёй. Технический лидер проверяет diff, test evidence и отдельный deployment/IAM plan до запуска доставки в production.

## Проверки

19 targeted unit tests прошли; проверки Firestore adapter используют FakeFirestore и не выполняют реальные Firestore writes. Отдельный реальный `getMe` успешно подтвердил ожидаемую bot identity; запрос не читал и не записывал Firestore. `npm run telegram:check` является read-only проверкой внешней identity. Тесты и `getMe` не доказывают production readiness, работу source observers, реальную семейную привязку или rollout.

## Согласование

Основание — прямой запрос пользователя начать Telegram service и подтверждённое наличие локальной переменной `AGI_EDU_BOT`. Согласованный результат — частичный runtime foundation с явным запуском worker и выключенной по умолчанию delivery. Следующие behavioral increments, link-token UI, источники, production IAM и rollout требуют отдельных подтверждённых проверок.
