---
id: decision.firestore-live-discovery-2026-10-19
status: accepted
implementation: implemented
created: 2026-10-19
updated: 2026-10-19
parent: service.telegram-bot
uses:
  - service.telegram-bot.firestore
  - service.telegram-bot.operations
  - service.telegram-bot.education-sync-dispatch
  - module.synchronization.firestore-read-paths
consumers:
  - Telegram worker maintainer
  - Education operator
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Подписка на новые документы Firestore

## Основание

Пользователь19.10 повторно сообщил, что новая загрузка не вызывает своевременное уведомление и проверку; требуется постоянная подписка на Firebase. Read-only диагностика установила62с от подтверждения файла до обнаружения и ещё35с до Telegram. Предыдущий due-wakeup исправлял только ожидание после обнаружения.

## Было → стало

Было: слушатели известных документов не замечали новые IDs. Их находил периодический полный inventory; Firestore и МЭШ делили очередь обработки и построение inventory.

Стало: отдельные Firestore/Mesh coordinators используют общие порты и pipeline. Коллекции загрузок и progress известного владельца, а также assignments и dayOwners известной семьи наблюдаются через snapshot listeners. Новый ID проходит адресную проверку владельца и durable origin classification; это не требует полного обхода на каждый файл. Неизменные известные IDs обслуживаются прежними документными слушателями. Сохранение этих слушателей защищает доставку при отказе нового collection watch; дополнительное чтение collection snapshots учитывается в реестре.

Первый исторический срез новой семьи тихий. Неизвестная работа уже подтверждённого контекста, в том числе в первом snapshot после restart, считается новой. Обновление inventory не удаляет конкурентно обнаруженные scopes; partial inventory добавляет targets здоровых семей и сохраняет targets ошибочных Firestore contexts. Закрытие снимает подписки, прекращает новые задания и дожидается начатых; обработка candidates ограничена concurrency, число семей не ограничивается. Реальные collection acknowledgements отражаются отдельным health event; PID сам по себе их не доказывает.

## Действия и роли

Семейный доступ, текущий owner, подтверждённое хранение файла, event dedupe, Telegram grouping и EducationSync claim/complete сохраняются. Подписка сама не запускает LLM: запуск следует только из подтверждённого события и durable dispatch. Полный execution artifact остаётся отдельным planned контрактом. Учебные результаты, интерфейс и PWA этой итерацией не меняются.

## Проверки

Luna реализует; независимая Luna и техлид сверяют код и ожидания тестов. Обязательны: новый документ в пустой коллекции без очередного inventory; initial snapshot после restart; bootstrap новой семьи; заблокированный Mesh при работающем Firestore; event во время reconcile; закрытие и reconnect; отказ collection watch при сохранении record listeners; bounded candidate concurrency и повтор транзакции без speculative origin. Read-only events CLI показывает source→detection для Firestore work; школьные даты МЭШ не выдаются за transport latency. Source fingerprints, read inventory, спецификации, полный check и git hooks проверяются перед выпуском. Production installation и новая естественная доставка подтверждаются отдельно.

Затронутые файлы: `packages/telegram-notifications/adapters/source-firestore.mjs`, `packages/telegram-notifications/adapters/source-inventory-firestore.mjs`, `packages/telegram-notifications/adapters/source-discovery-firestore.mjs`, `packages/telegram-notifications/adapters/source-coordinator.mjs`, `packages/telegram-notifications/adapters/runtime.mjs`, `scripts/education-sync-dispatch.mjs`.

## Согласование

Прямое разрешение пользователя: реализация через Luna, проверка техлидом, тесты/спецификации, согласованный выпуск в main и постоянный процесс на Mac. Root владеет Telegram install; соседний опубликованный сайт сохраняется. Локальные тесты не объявляются live замером следующей загрузки.
