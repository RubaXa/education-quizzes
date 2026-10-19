---
id: service.telegram-bot.firestore
status: accepted
implementation: partial
created: 2026-10-16
updated: 2026-10-19
consumers:
  - "Telegram service implementer"
  - "bot operator"
  - "parents and guardians"
code:
  - packages/education-runtime/event-queue.mjs
  - packages/education-runtime/legacy-event-reconciliation.mjs
  - packages/telegram-notifications/adapters/source-firestore.mjs
parent: service.telegram-bot
uses:
  - shared.server-runtime
  - module.synchronization.event-queue
sections:
  - ответственность
  - единый-вход-событий
  - адресное-чтение-источника
  - обратная-совместимость
  - приватность-и-эксплуатация
---
# Адаптер событий Education через Firestore

**Родитель:** [корневая архитектура](../README.md); [порт и события](../ports-and-events.md); [контракт общей очереди](../../../modules/synchronization/event-queue.md).
**Статус:** backend runtime подключён к единой очереди локально; producers, правила, индексы и постоянный release ещё проходят совместную проверку. Наличие кода не означает завершённую миграцию.

## Ответственность

Приложение и доверенные серверные процессы записывают типизированные действия в `educationEvents/{eventId}`. Firestore используется как durable ingress, а не как runtime inventory источников. Очередь дедуплицирует устойчивую идентичность действия; один consumer подписывается на `state == pending`, упорядоченный по `availableAt`. Все действия и нормализованные МЭШ изменения используют этот ingress. В worker нет динамических source collection/document listeners.

Для каждого события consumer транзакционно захватывает lease с fencing token, выполняет ограниченные fanout-фазы и сохраняет checkpoint после каждой завершённой фазы. Повторы обрабатываются идемпотентно. Истёкшие lease обнаруживаются ограниченными запросами по расписанию. Обычное Telegram delivery остаётся отдельной durable outbox-работой и не удерживает ingress lease.

## Единый вход событий

События используют одну подписку очереди, описанную в [контракте](../../../modules/synchronization/event-queue.md#назначение-и-единственная-подписка). Этот раздел заменяет прежний graph source-listener.

<a id="подписка-и-обработка-сигнала"></a>

## Адресное чтение источника

Событие содержит тип, семью/ребёнка, автора, операционный ID и точный `sourceRef`. Для `upload.confirmed`, `quiz.submitted` и `review.published` runtime читает только указанный источник через существующий Firestore source adapter и его проверку владельца. Эти reads — targeted reads из handler, они не создают подписок или глобального сканирования.

`help.requested`, `quiz.followup_requested`, `upload.confirmed` и поддержанные material actions направляются в существующий typed `EducationSyncDispatcher` с точной ссылкой на источник и артефакт задачи. Неподдержанный action видимо блокируется; он не превращается в общий Mesh или inbox запрос. Parent guidance, decisions, review receipts и изменения требований не запускают новый LLM workflow.

МЭШ остаётся отдельным HTTP poller. Его проверенные изменения публикуются в ту же `educationEvents` очередь, затем проходят общую NotificationService и typed dispatcher.

## Обратная совместимость

Старые клиенты пока могут записывать исходные документы без queue envelope. Ограниченный reconciler раз в 15 секунд читает одну страницу за source и хранит cursor/ошибки в служебном checkpoint. Он охватывает legacy help/quiz actions; upload и book-upload совместимость обслуживает upload broker. Это временный polling bridge, а не collection listener. Первый запуск использует ограниченный 24-часовой lookback, пропускает уже разрешённую/обработанную работу и сохраняет неудачные item для повтора без блокировки следующих записей.

Период совместимости завершается только после подтверждения producer coverage, правил и индексов, worker readiness и deployed PWA с новым producer. До этого событие queue runtime не считается полной миграцией всех клиентских действий.

<a id="области-данных-для-валидации"></a>

## Приватность и эксплуатация

Firestore transaction и Security Rules проверяют неизменяемую идентичность клиентского event и ограничивают допустимые поля. Серверные producers используют тот же канонический event ID и атомарно записывают envelope вместе с исходным действием, где это возможно. События не содержат свободных ответов или файлов; Mesh payload использует узкий whitelist. Worker повторно читает только разрешённую часть точного source document.

Оператор проверяет состояние через `npm run events:status` и Telegram runtime readiness. Queue listener acknowledgement подтверждает только подписку/первичный снимок, а не полноту producer миграции или фактическую доставку Telegram. Исторические source coordinator и inventory модули могут оставаться в checkout для явной диагностики/старого инструментария, но production runtime их не запускает.

<a id="масштабирование"></a>
