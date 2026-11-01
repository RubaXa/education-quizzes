---
id: decision.mesh-auth-recovery-2026-11-01
status: accepted
implementation: implemented
created: 2026-11-01
updated: 2026-11-01
parent: module.synchronization
uses:
  - shared.server-runtime
  - module.school-diary
consumers:
  - operator
  - shared runtime
code:
  - diary/cli.mjs
  - packages/education-connect/lib/mesh.mjs
  - packages/education-runtime/mesh-session.mjs
  - packages/telegram-notifications/adapters/source-mesh.mjs
  - packages/telegram-notifications/adapters/source-inventory-firestore.mjs
  - packages/telegram-notifications/operations/source-check.mjs
  - scripts/sync-project.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Отказ регистрации МЭШ не является сетевым сбоем

## Основание

Родитель потребовал выяснить и исправить причину недоступного МЭШ и сверить ЦДЗ.
Сеть отвечает200; профиль401 и OAuth invalid_client доказывают отказ сохранённой
регистрации. Прежняя session сворачивала его в mesh_unavailable/source-error.

## Было → стало

`packages/education-connect/lib/mesh.mjs` сначала применяет родительский refresh grant,
передаёт фиксированные безопасные code/stage/httpStatus/oauthError без сырого ответа.
`packages/education-runtime/mesh-session.mjs` сохраняет авторизационную причину
и ошибку записи токена, не подменяя их сетевой недоступностью.
`packages/telegram-notifications/adapters/source-mesh.mjs`,
`packages/telegram-notifications/adapters/source-inventory-firestore.mjs` и
`packages/telegram-notifications/operations/source-check.mjs` не теряют этот код.
`scripts/sync-project.mjs` классифицирует auth-required и сохраняет безопасную
диагностику в существующей закрытой квитанции. `diary/cli.mjs` показывает причину
и штатное переподключение через npx education-connect с новым приглашением.

## Действия и роли

Проверки владельца и семейной принадлежности обязательны. Новый вход не обходится;
пароль и SMS остаются в скрытых полях штатного пакета. Старые работы и результаты
не меняются. При отказе доступа сверка результатов ЦДЗ остаётся незавершённой.
Новый одноразовый код требует явного согласия адресата; это отдельная операция.
Нет исходящих сообщений между чатами и нового расписания.

## Проверки

Регрессии: invalid_client и отсутствие записи при отказе; успешная ротация,
повтор исходного чтения; отказ сети отдельно; сохранение авторизационного кода
через owner/session и автоматический source adapter; отсутствие частных URL,
тела ответа и токенов в диагностике. Перед выпуском обязательны полный check и
проверка текущего runtime. Новая авторизация не считается успешной по выдаче кода:
нужны receive, owner verification, свежий сбор и адресный readback.

## Согласование

Прямой запрос родителя01.11: устранить причину МЭШ, проверить три ЦДЗ и использовать
ранее подготовленный npx-пакет. Отдельно разрешён код переподключения своей семьи.
