---
id: service.telegram-bot.operations
status: accepted
implementation: planned
parent: service.telegram-bot
uses:
  - service.telegram-bot
sections:
  - runtime-boundary
  - конфигурация
  - iam-и-данные
  - здоровье-и-сигналы
  - развёртывание-и-rollout
  - подмодули

---
# Runtime и эксплуатация Telegram notification service

**Родитель:** [корневая архитектура](README.md).
**Статус:** target operations contract; хостинг и эксплуатационный worker ещё не настроены.

## Runtime boundary

Рекомендуемый первый runtime — один постоянно работающий Node.js worker с long polling Telegram и Firestore listeners плюс периодический МЭШ poll. Это упрощает окна группировки и восстановление outbox. Host/deployment не выбран; Firebase Functions — отдельная альтернатива с иным scheduler/webhook контрактом, а не переключение одной переменной.

Runtime composition root загружает/валидирует config, создаёт adapters, порты, application services, health state и graceful shutdown. Core modules не читают process.env. Остановка прекращает новые source signals, дожидается ограниченный срок текущей транзакции/записи job, затем закрывает listeners и bot.

## Конфигурация

Минимальные группы параметров:

- Telegram bot token и разрешённые team recipient IDs.
- Firestore project/database и source path registry.
- Окна группировки, poll interval, retry bounds, lease duration, concurrency limits.
- Environment/instance ID, log level, privacy-safe diagnostics.

Секреты передавать через host secret manager или ADC; никакого `.env`, credentials JSON или token в Git/логах. Конфигурация валидируется при старте. Опасная пустая команда получателя или проект Firestore должна останавливать readiness, а не молча отправлять в неверное место.

## IAM и данные

Отдельная workload identity с минимальными правами на согласованные source paths и служебные registry/ledger/outbox. Серверный SDK обходит Security Rules; правила клиента не ограничивают worker. Не выдавать project-wide Owner/Editor. Отделить read-only доступ к учебным источникам от ограниченного write доступа к служебным коллекциям настолько, насколько позволяет IAM/структура проекта.

## Здоровье и сигналы

В структурированные logs/metrics включать instance, module, scope hash, eventId, duration, retry/error class и backlog. Не включать имена детей в метрики, raw payload, Telegram token/chat body, credentials или закрытые ответы.

Readiness учитывает Telegram authorization, Firestore connectivity, активность обязательных source adapters и просрочку успешного poll. Ошибка одной семьи/учётной записи адресуется её scope и не маскируется общим зелёным статусом. Команда получает структурированный сигнал о source outage и recovery digest согласно бизнес-контракту.

## Развёртывание и rollout

1. Локальный dry-run на фиксированных безопасных fixtures.
2. Source shadow mode: записывать ожидаемые DomainEvents без Telegram send.
3. Сравнить выборку events с источником и проверить утечки/дедупликацию.
4. Включить allowlist семей и тестовый получатель.
5. Включить общий охват, наблюдая latency, backlog и dead-letter.

Rollback выключает source processing и сохраняет ledger/outbox для дальнейшего разбора. Не удалять очередь/registry при rollback. Перед первой эксплуатацией определить retention, алертинг и владельца ручной обработки dead letters.

## Подмодули

После выбора host вынести `deployment/<host>.md`; если появятся on-call процедуры — `runbooks/<incident>.md`. Не описывать невыбранный хост как действующий.
