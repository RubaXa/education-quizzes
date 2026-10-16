---
id: service.telegram-bot.identity-and-linking
status: accepted
implementation: partial
created: 2026-10-16
updated: 2026-10-16
consumers:
  - "Telegram service implementer"
  - "bot operator"
  - "parents and guardians"
code:
  - "packages/telegram-notifications/application/identity.mjs"
  - "packages/telegram-notifications/adapters/telegram.mjs"
parent: service.telegram-bot
uses:
  - service.telegram-bot
  - service.telegram-bot.ports-and-events
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
**Статус:** целевой сценарий частично реализован. Account registration and confirmed `/stop` exist; family linking does not.

Выпуск и погашение семейного link token не включены: оба пользовательских UI flow отсутствуют, поэтому бот не доверяет произвольному `familyId` и требует внедрённый trusted `FamilyLinkAuthorizationPort` с подтверждённым PETR actor и live membership. Без такого порта `/start <payload>` не создаёт семейную связь.

## Модель идентичности

Telegram account идентифицируется неизменяемым numeric `telegramUserId`; username и имя — только изменяемые отображаемые поля. Telegram-чат доставки хранится отдельно от пользователя. Начало диалога регистрирует аккаунт, но не даёт доступа к семье.

Одна связь связывает account с одной `familyId` и включает состояние, timestamps, источник подтверждения, кто подтвердил операцию и историю изменений. Один Telegram account может иметь несколько независимых семейных links; несколько взрослых могут быть связаны с одной семьёй.

## Состояния

`unregistered → registered → link_pending → linked → disconnected`

- `blocked`/`delivery_unavailable` — состояние канала/адресата, не отзыв семейного доступа.
- Повторный Start обновляет account metadata и выдаёт безопасную подсказку; не создаёт повторную link и не реактивирует отключённую связь молча.
- Отключение одной family link оставляет account и другие links зарегистрированными.
- История переходов append-only; актуальное состояние — проекция/текущий документ.

## Привязка и подтверждение

Поддерживаются два направления: авторизованный PETR пользователь создаёт токен для Telegram deep link; либо Telegram получает короткий токен/ссылку, после чего вошедший в PETR пользователь явно подтверждает конкретный account. В обоих случаях доверенная серверная операция связывает авторизованную PETR identity и Telegram account. Нельзя принимать ручной `familyId`/`childId` от пользователя как доказательство доступа.

Token requirements: криптографически случайный, одноразовый, хранимый только как hash, ограниченный по сроку, account и ожидаемому действию; атомарное погашение; защита от повторного использования; отзыв/повторный выпуск; rate limit. Точный TTL и конкретная UI-последовательность остаются открытыми решениями.

## Отключение

`/stop` в личном чате:

1. Если активна одна family link — запросить явное подтверждение отключения этой связи.
2. Если links несколько — предложить выбрать одну; callback подтверждения должен быть связан с отправителем и краткоживущим действием.
3. Отозвать только выбранную связь и подтвердить результат.
4. Если связей нет — объяснить текущее состояние и способ повторной привязки.

Поведение команды глобального выключения бота для всех семей пока не определено и не должно выводиться из `/stop`.

## Данные и доступ

Реализация первого среза использует `telegramBotAccounts/{telegramUserId}`, `telegramBotFamilyLinks/{linkId}`, `telegramBotStopChallenges/{sha256(callbackToken)}` и append-only `telegramBotLinkHistory/{linkId_tokenHash}`. `tokenHash` — SHA-256 подтверждения, он не раскрывает raw callback token. Семейная связь должна быть создана только trusted `FamilyLinkAuthorizationPort`; его production adapter/issuer пока отсутствует. Membership проверяется заново по `families/{familyId}/members/{personId}`: `active`, роль `parent` и точное наличие `childId`. Перед enqueue и каждым отправляемым part проверяются также текущие `telegramBotFamilyLinks` state/owner. Уникальность активной пары account/family и выпуск токенов остаются ответственностью trusted issuer, который ещё не реализован.

Не логировать токен, приватные Telegram updates, контакты или raw message body. Username обновлять как метаданные и не использовать в авторизации. При удалении/отзыве сохранять минимальную историю, необходимую для аудита, с retention policy, которую надо утвердить.

## Подмодули

Если web-часть привязки меняется независимо от Telegram flow, вынести `linking/petr-first.md` и `linking/telegram-first.md`. Если требования хранения/удаления созреют, вынести `identity-retention.md`.
