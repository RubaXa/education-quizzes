---
id: decision.telegram-review-fixes-2026-10-17
status: accepted
implementation: not-applicable
created: 2026-10-17
updated: 2026-10-17
parent: service.telegram-bot
uses:
  - service.telegram-bot.ports-and-events
  - service.telegram-bot.identity-and-linking
  - service.telegram-bot.event-ledger-outbox
consumers:
  - Telegram service developer
  - Technical lead
  - Bot operator
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Исправления по повторному Telegram fact-check

## Основание

Пользователь прямо запросил исправить найденные проблемы через Luna Worker, добавить тесты, обновить спецификации, прогнать проверки и выполнить commit/push. Основание — [повторный аудит](../audits/telegram-self-review-2026-10-16.md#recheck-2026-10-17) с воспроизводимыми snapshot/context-ref дефектами, недиагностичным отрицательным тестом и неполным учётом состояния канала. Историческое evidence аудита сохраняется как снимок до исправления.

## Было → стало

Строгий boolean-признак полного snapshot и идемпотентная нормализация context refs заменяют truthiness и повторное хэширование. Тест partial snapshot должен достигать проверки полноты с валидным detectedAt. Реестр доступности Telegram канала отделён от семейного доступа; канал обновляется по проверенным private updates и delivery failure. Ошибка Telegram не отзывает family link и не выдаёт произвольному аккаунту доступ. При неизвестном прежнем состоянии канала сохраняется совместимость с существующими account records. Счётчик queued учитывает только созданные jobs.

Source adapters, семейный issuer/UI, группировка и production rollout остаются незавершёнными. Этот ремонт не запускает worker или доставку во внешние системы.

## Действия и роли

Luna изменяет runtime и регрессионные тесты. Технический лидер отдельно проверяет переходы состояния, scope авторизации, сохранение семейных links, отклонение старых updates, privacy и воспроизводимость сценариев. Прямой private Start подтверждает доступность канала, но не реактивирует отозванные семейные связи. Недоступность канала не заменяет проверку membership родителя и ребёнка.

## Проверки

Worker зафиксировал RED: 8 новых failing cases / 27 tests до исправлений; после расширения покрытия GREEN: 33/33. Техлид независимо повторил targeted suite: 33/33. Приватная проверка якорей: 17/17 tests; это локальные tools PETR, они не публикуются вместе с публичным репозиторием.

Изменённые runtime-файлы: `packages/telegram-notifications/adapters/firestore.mjs`, `packages/telegram-notifications/adapters/memory.mjs`, `packages/telegram-notifications/adapters/runtime.mjs`, `packages/telegram-notifications/adapters/telegram.mjs`, `packages/telegram-notifications/application/identity.mjs`, `packages/telegram-notifications/application/notifications.mjs`, `packages/telegram-notifications/domain/diff.mjs`, `packages/telegram-notifications/domain/events.mjs`, `packages/telegram-notifications/domain/ports.mjs`. Регрессионный набор — `packages/telegram-notifications/notifications.test.mjs`; полный gate — `npm run check`, включая specification graph, UI decision fingerprints, read-site registry, lint и Vitest. Полный `npm run check` прошёл: 540 тестов в 124 файлах, specification/UI/read gates и lint без ошибок. Build пропущен по неизменному fingerprint сайта; новая frontend сборка для этого ремонта не создавалась.

## Согласование

Прямое разрешение пользователя: «Давай исправлять найденные проблемы через Luna Worker, ты проверяешь результат. Добавьте тесты на эти случаи, обновите спецификации, прогоните проверки и закоммитьте с пушем». Значения секретов не включаются в код, документацию, тестовые fixtures или Git. Исходный UI baseline не изменяется; новые отпечатки фиксируются отдельно после ревью runtime.
