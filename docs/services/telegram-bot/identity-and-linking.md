---
id: service.telegram-bot.identity-and-linking
status: accepted
implementation: partial
created: 2026-10-16
updated: 2026-10-17
consumers:
  - "Telegram service implementer"
  - "bot operator"
  - "parents and guardians"
code:
  - "packages/telegram-notifications/application/identity.mjs"
  - "packages/telegram-notifications/adapters/telegram.mjs"
  - "packages/telegram-notifications/adapters/firestore.mjs"
  - "packages/telegram-notifications/adapters/memory.mjs"
  - scripts/telegram-pair.mjs
parent: service.telegram-bot
uses:
  - service.telegram-bot
  - service.telegram-bot.ports-and-events
  - shared.server-runtime
sections:
  - модель-идентичности
  - состояния
  - привязка-и-подтверждение
  - отключение
  - данные-и-доступ
  - подмодули
---
# Реестр Telegram identity и семейная привязка

**Родитель:** [корневая архитектура](README.md); [порты и события](ports-and-events.md); [семейная модель](../../modules/families/README.md).
**Статус:** регистрация, подтверждённый `/stop` и локальная доверенная привязка реализованы; web UI привязки отсутствует. Реальная отправка требует отдельно подтверждённой связи.

При private `/start` без активной связи бот выдаёт одноразовый код для локального оператора. Он не доверяет произвольному `familyId` из Telegram. Общие доказательства владельца источника принадлежат [серверному ядру](../../shared/server-runtime.md#авторизация-и-совместимость).

## Модель идентичности

Telegram account идентифицируется неизменяемым numeric `telegramUserId`; username и имя — только изменяемые отображаемые поля. Telegram-чат доставки хранится отдельно от пользователя. Начало диалога регистрирует аккаунт, но не даёт доступа к семье.

Одна связь связывает account с одной `familyId` и включает состояние, timestamps, источник подтверждения, кто подтвердил операцию и историю изменений. Один Telegram account может иметь несколько независимых семейных links; несколько взрослых могут быть связаны с одной семьёй.

## Состояния

`unregistered → registered → link_pending → linked → disconnected`

- Состояние Telegram-канала хранится отдельно как `channelStatus: available|blocked|unavailable`. `my_chat_member` обновляет его по проверенным private событиям; `403` означает только `unavailable`, поскольку один код ошибки не доказывает блокировку пользователем. Изменение канала не отзывает семейный доступ.
- Повторный Start обновляет account metadata и выдаёт безопасную подсказку; не создаёт повторную link и не реактивирует отключённую связь молча.
- Отключение одной family link оставляет account и другие links зарегистрированными.
- История переходов append-only; актуальное состояние — проекция/текущий документ.

### Реестр доступности канала

Account хранит `channelStatus`, `channelStatusVersion`, `channelStatusChangedAt` (epoch milliseconds), `channelStatusSource`, `lastChannelUpdateId` и `lastChannelUpdateAt`. Доступность не является доказательством семейной авторизации. Существующий legacy account без channelStatus совместим с available; отсутствующий account недоступен до достоверного Start/membership update. Достоверное первое membership событие создаёт только минимальную account запись, без family link; delivery failure не создаёт account.

`/start` передаёт Telegram update ID и `message.date`. `my_chat_member` принимается только в private chat с `chat.id = from.id`, для bot user ID, совпавшего с доверенным ID текущего бота. `member → available`, `kicked → blocked`, `left → unavailable`; неизвестные статусы не меняют реестр. При повторном Start существующие отключённые family links остаются отключёнными.

Транзакция отклоняет повтор/меньший update ID и более старое event time. В ту же секунду больший Telegram update ID задаёт порядок. После интервала не меньше семи дней между доверенными Telegram event times допускается меньший/равный ID: установленный SDK документирует случайный выбор следующего update ID после недели без updates (`@grammyjs/types/update.d.ts`, поле `Update.update_id`). Это допустимое окно reset, не утверждение, что данный аккаунт наблюдал глобальный простой бота. Дубликаты прежнего времени всё равно отклоняются.

Перед job и каждой частью `ChannelAvailabilityPort.getState` адресно проверяет доступность; недоступность блокирует job, не family link. Временная ошибка чтения состояния даёт bounded retry, а не permanent failure. `403` сохраняет unavailable только с expected channel version из начала попытки: поздний ответ не перезаписывает новый Start/unblock. Неупорядочиваемый cross-source update с event time не новее локальной отметки failure отклоняется; новое явное `/start` с более поздним временем подтверждает recovery. Host clock должен быть синхронизирован. Ошибка записи failure оставляет lease для обычного восстановления. Уже terminally blocked jobs не возрождаются автоматически; replay для ранее авторизованных адресатов остаётся отдельной политикой.

## Привязка и подтверждение

Реализовано направление Telegram → доверенный локальный CLI: пользователь получает код в private чате, оператор выполняет `npm run telegram:pair -- --family FAMILY_ID --person PERSON_ID` и вводит код через скрытый stdin. Код не передаётся в argv, журнал или Git. Локальный authorizer требует точного parent mapping в family-access, действующего source owner и текущего семейного registry/member/child/identity; произвольного знания familyId недостаточно. Web PETR-first/deep-link flow остаётся целевым.

Код содержит16 hex криптографической случайности; хранится SHA-256, точный отправитель, действие `link-family`, время выпуска и TTL10 минут. Транзакционный cooldown60 секунд ограничивает повторный Start; перевыпуск инвалидирует прежний код. Транзакция погашения повторно проверяет срок, доступность account, действие, текущий hash, отсутствие использования и семейные права. Стабильный linkId определяется парой sender/family; конфликт другого person отклоняется. Погашение и append-only история атомарны. Отключённая связь не возобновляется от простого Start.

## Отключение

`/stop` в личном чате:

1. Если активна одна family link — запросить явное подтверждение отключения этой связи.
2. Если links несколько — предложить выбрать одну; callback подтверждения должен быть связан с отправителем и краткоживущим действием.
3. Отозвать только выбранную связь и подтвердить результат.
4. Если связей нет — объяснить текущее состояние и способ повторной привязки.

Поведение команды глобального выключения бота для всех семей пока не определено и не должно выводиться из `/stop`.

## Данные и доступ

Хранилища: `telegramBotAccounts`, `telegramBotFamilyLinks`, `telegramBotPairChallenges` (hash ключ), `telegramBotStopChallenges` и append-only `telegramBotLinkHistory`. Точные имена и поля определяет Firestore adapter. Непрозрачные исторические links сохраняются, автоматически не мигрируются и не реактивируются. Перед enqueue и каждым part проверяются текущие link, активный parent membership и точный childId; подтверждение Start само по себе семейных прав не даёт.

Не логировать токен, приватные Telegram updates, контакты или raw message body. Username обновлять как метаданные и не использовать в авторизации. При удалении/отзыве сохранять минимальную историю, необходимую для аудита, с retention policy, которую надо утвердить.

## Подмодули

Если web-часть привязки меняется независимо от Telegram flow, вынести `linking/petr-first.md` и `linking/telegram-first.md`. Если требования хранения/удаления созреют, вынести `identity-retention.md`.
