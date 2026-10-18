---
id: decisions.role-projection-diagnostics-2026-10-18
status: accepted
implementation: implemented
created: 2026-10-18
updated: 2026-10-18
parent: module.families.access-and-state
uses:
  - shared.access-and-privacy
consumers:
  - parent
  - student
  - access incident operator
code:
  - src/lib/roleDiagnostics.ts
  - scripts/lib/role-diagnostics.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Измерение фактически открытой роли

## Основание

Родитель продолжает видеть ученическую загрузку в обычном production web после исправлений и прямо отказывается от дальнейших вопросов, открытия других ссылок и проверок чужого браузера. Серверные связи согласованы, независимый race fix опубликован, но причинная связь с этим случаем не установлена. Нужно измерение самого клиента; отсутствие отчёта не означает отсутствия дефекта.

## Было → стало

src/lib/roleDiagnostics.ts получает адресное временное окно из уже существующих member snapshots в src/components/LearningRoute.tsx и src/components/PersonalEntry.tsx. src/DayPage.tsx и src/WeekendMathSlot.tsx передают точного владельца общему src/components/ProblemTaskCard.tsx, который пассивно сообщает фактический parent-признак и наличие guide. Карточка и её действия не меняются. Ноль новых клиентских чтений/подписок, дедуп одинаковых номеров. Операторский scripts/lib/role-diagnostics.mjs подключён в scripts/family.mjs командами diagnostics-start/read/stop; окно ограничено60минутами, default30, writes/readback изменяют только expiry членства.

## Действия и роли

firestore.rules разрешает только own-UID запись действующей личности/ребёнка в clientRoleDiagnostics, подтверждённую членством, операторским expiry и whitelist. Клиенту запрещены чтение/удаление. Данные — технические person/family/child IDs, member/profile/render roles, наличие guide, тип экрана и sampledAt/expiry; без учебного текста, ответов, фото, ключей ссылок, полного URL, IP или user-agent. Это измерение не выдаёт полномочия и не переключает режим. По умолчанию probe выключена. После expiry/stop нет отправок, сбой probe не влияет на работу. Корневая роль и общий URL сохраняют прежние контракты.

## Проверки

roleDiagnostics.test проверяет выключенный/истёкший scope,8одинаковых карточек→1запись, приход guide, чужой child/Auth, отсутствие секретов и cleanup. Реальная композиция LearningRoute.weekend.integration подтверждает запись конечной карточки под тем же серверным member listener. CLI test проверяет адресность, expiry bound, только одно изменяемое поле и readback. Rules test — статическая защита; не выдаётся за emulator coverage. Синтаксическая компиляция правил и фактическая публикация проверяются отдельно при deploy; успешные unit tests не доказывают наличие production telemetry. Собственный контрольный browser не используется для закрытия пользовательского инцидента.

## Согласование

Прямые требования родителя: исследовать реальный веб-дефект сверху вниз; не заставлять открывать новые ссылки и не запрашивать повторные описания; использовать измерения/стандартные CLI и покрывать правила тестами. Окно включается адресно только на известные профили этой семьи. Публикация согласуется с параллельной Telegram-сессией; rules предшествуют web. После обнаружения причины probe останавливается, а исправление выполняется отдельно по доказательствам.
