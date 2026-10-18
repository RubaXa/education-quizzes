---
id: audit.education-bot-readiness-2026-10-18
status: reference
implementation: not-applicable
created: 2026-10-18
updated: 2026-10-18
parent: service.telegram-bot
uses:
  - service.telegram-bot.delivery
  - service.telegram-bot.operations
  - product.notifications
consumers:
  - Education development team
  - Telegram implementer
  - release operator
code: []
sections:
  - метод-и-факты
  - результат-сверки
  - почему-нет-командных-сообщений
  - следующий-законченный-инкремент
  - критерии-приёмки
  - оставшиеся-пробелы
---

# Аудит бота и командных уведомлений Education

## Метод и факты

Независимая Luna прочитала код/specs без сетевых вызовов и правок. Техлид перепроверил выводы по исполняемым веткам и реальному runtime18.10.2026. Checkout `main` на момент сверки —06ee5b5; PR8 ранее слит вeb8b5e3. Проверки текущей сети — read-only; новых сообщений и учебных записей аудит не создаёт.

Подтверждены Telegram `getMe` с правильным username, running LaunchAgent, readiness readyForDelivery, доступные Firestore/outbox queries и одна активная авторизованная семейная связь. Все31файл import closure установленного release94a5f463ca87291bb5ab5e57 совпали с main; package-lock и production dependencies тоже. Отличается только package.json после добавления отдельной CLI-команды: функциональный код бота совпадает, весь release bundle нельзя называть побайтно актуальным без этой оговорки.

Последний startup в журнале —18.10,09:01:32МСК, Firestore/МЭШ/delivery включены. После него в worker log нет новых source-observation-blocked; прежние2559записей относятся к историческим запускам. Есть текущие успешные IO/pipeline spans. Span outcome=ok означает отсутствие исключения и не доказывает отправку сообщения или полный свежий охват. Последняя отдельная полная МЭШ сверка93/93 описана в [решении](../decisions/mesh-calendar-date-scopes-2026-10-18.md); этот аудит повторно весь источник не опрашивал.

## Результат сверки

| Сценарий | Реализация | Фактическое доказательство и граница |
|---|---|---|
| Start/реестр/локальная семейная привязка/Stop | Есть | Работающий private polling; одна подтверждённая связь. Web linking UI отсутствует |
| Семейные Firestore/МЭШ события | Есть | SourcePipeline, diff, ledger/outbox; оба источника включены. Первая baseline тихая |
| Telegram transport и retry/receipts | Есть | Ранее обе технические пробы sent/readback; getMe сейчас успешен. Это не доказательство каждого естественного события |
| Командный поток учебных событий | Не подключён | `accept` разрешает только family-summary/family-link; team renderer не создаёт получателей |
| Изменения main и обновления сервисов | Не реализованы | Нет event types, producer hook и командного recipient resolver |
| Ошибки и восстановление сервисов | Только локальные logs/telemetry | Внешние alerts и независимый watchdog отсутствуют |
| Группировка30/60секунд и контекстные ссылки | Не реализованы | Текущий путь отправляет отдельные event parts |

## Почему нет командных сообщений

В [каталоге событий](../../packages/telegram-notifications/domain/events.mjs) нет operational release events. [NotificationService.accept](../../packages/telegram-notifications/application/notifications.mjs) отвергает privacyClass кроме family-summary и строит задания только для family-link. [Renderer](../../packages/telegram-notifications/domain/renderer.mjs) имеет team branch, но этот путь недостижим из текущего service accept.

Ни [installer](../../packages/telegram-notifications/operations/launch-agent.mjs), ни [Git-хуки](../../lefthook.yml), ни [publisher](../../scripts/publish-pages.mjs) не создают командное Telegram-событие о результате выпуска. Поэтому слияние или установка сами по себе не могли дать ожидаемое сообщение. Readiness проверяет инфраструктурные условия и семейную авторизацию; он не подтверждает полноту командного сценария. Предыдущий итог о готовности сервиса был шире фактически выпущенного пользовательского результата.

Название продукта и команды по текущему прямому указанию — **Education**. Пользовательские строки renderer/Start пока содержат прежний бренд: это отдельный подтверждённый пробел. Внутренние пути Mac/LaunchAgent и `petr-private:` — техническая совместимость; их переименование требует миграции, иначе можно потерять общий vault или запустить второй worker.

## Следующий законченный инкремент

**Командные уведомления Education о завершённой итерации.** Два различимых факта:

1. `main.updated`: подтверждённое изменение основной ветки, commit и короткое содержательное описание. Это ещё не успешная установка.
2. `service.updated`: фактически установленный/опубликованный service release, commit/artifact hash, время и успешная проверка здоровья/адресного readback. Успех не выводится из одного merge или bootstrap exit0.

На первом этапе адресат — подтверждённый личный Telegram команды; замена на группу остаётся конфигурацией доверенных numeric IDs, без авторизации по username. Семейная роль не становится командной автоматически. Решение не создаёт фиктивные familyId/childId: нужен отдельный operational event/recipient contract и общие outbox/transport/retry/receipt механизмы. Конкретная версия job schema и её совместимость с текущими pending jobs обязательны в реализации.

Producer подключается к штатному release workflow после подтверждения каждого факта. Повторная обработка того же event+recipient не создаёт новую job. Командная сводка включает только Education, сервис, что изменилось, commit/release, время и подтверждённый результат. Семейные данные, credentials, raw SDK errors и частные пути в сообщение не попадают. Пользовательские renderer/Start строки переводятся на Education в том же инкременте.

Это предложение следующего выпуска, **не готовая функция**. Общий поток учебных событий команды остаётся отдельным принятым требованием и этим operational маршрутом не заменяется.

## Критерии приёмки

- Реальный согласованный выпуск из main автоматически даёт ожидаемое сообщение в подтверждённый командный чат с readback receipt; ручная technical.probe его не заменяет.
- Merge без установки не сообщает «сервис обновлён». Неуспешная установка/непроверенный health не создают success event; после доказанного восстановления разрешён отдельный факт.
- Fake integration проходит producer→event→outbox→transport→receipt; проверяются адресат, доступ, branding, отсутствие семейных полей, повтор, restart/retry и обратная совместимость pending jobs.
- Идемпотентность job/receipt не обещает абсолютное exactly-once Telegram: неоднозначный исход отправки с падением до сохранения receipt сохраняет оговорку at-least-once.
- Функция доходит до main, установленного runtime и реального получения; спецификации и статус отражают именно этот результат.

## Оставшиеся пробелы

После этого инкремента отдельно закрываются: team academic summary; независимый watchdog для полного отказа worker; freshness/pending/backlog health; grouping; web linking; policy replay после блокировки; retention/dead letters; масштабирование и реальные API limits. Остановившийся бот не может сам сообщить о своей остановке — watchdog не включён в обещание текущего предложения.
