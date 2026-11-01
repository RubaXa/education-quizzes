---
id: decision.local-connect-diagnostics-2026-11-01
status: accepted
implementation: implemented
created: 2026-11-01
updated: 2026-11-01
parent: module.school-diary
uses:
  - shared.server-runtime
consumers:
  - parent
  - operator
code:
  - packages/education-connect/lib/prompts.mjs
  - scripts/connect-diagnose.mjs
  - packages/education-connect/bin/education-connect.mjs
  - packages/education-connect/lib/mesh.mjs
  - packages/education-connect/lib/login-diagnostics.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Локальный npm-вход для диагностики подключения

## Основание

Родитель прямо попросил локальный CLI через npm run вместо зависимости от npm-релиза.

## Было → стало

`package.json` добавляет connect:diagnose. `scripts/connect-diagnose.mjs` проверяет
среду и запускает локальный `packages/education-connect/bin/education-connect.mjs`
через process.execPath без shell и установки пакетов. --check не запускает вход.
`packages/education-connect/lib/mesh.mjs` передаёт диагностический callback;
`packages/education-connect/lib/login-diagnostics.mjs` выдаёт только stage,
HTTP-статус и нормализованный MIME-тип без тела, адреса или отправленных полей.
CLI показывает этап приглашения; известные Firebase коды не теряются.

## Действия и роли

Нужен явный код --invite. Имена/адреса proxy и CA не печатаются: только наличие.
TTY наследуется для скрытого пароля/SMS и видимого логина. Старые проверки
владельца и явное согласие перед зашифрованной передачей сохраняются.
Отчёт выводится в терминал, отдельных файлов диагностики нет. Реальный вход
выполняет пользователь; операторский --check не регистрирует OAuth-приложение.

По прямой просьбе родителя добавлен `--input-check`: локальная проверка ввода
без приглашения и без сетевых вызовов; возвращается до loadInvite/loginToMesh.
Печатаются число Unicode-символов, UTF-8 байтов и наличие пробелов по краям.
Пароль не обрезается и не нормализуется. Только `--show-password-prefix` раскрывает
первые до четырёх символов в терминале (не весь короткий пароль); управляющие
символы экранируются. Строку нельзя отправлять в чат, логи или handoff.
Логин — телефон, email или СНИЛС; +7XXXXXXXXXX является рекомендацией ввода, а не
доказанным требованием провайдера. SDK передаёт login как введён после trim
внешних пробелов. Ошибка регистрации400 до password не проверяет эти credentials.
Backspace исправлен: удаляет целую UTF-8 последовательность, включая ведущий байт.

## Проверки

Изолированная приёмка: --check не запускает connector, значения proxy не выходят
в stdout, неверные аргументы не запускают процесс, корректный код передаётся
локальному Node с TTY, без shell. HTTP callback не получает URL или содержимое.
Обязательны полный check и фактический npm run connect:diagnose -- --check.
Без результата реального входа восстановление МЭШ не заявляется.

## Согласование

Прямой ответ родителя01.11: сделать локальный cli-tool через npm run для сбора
диагностики. Публикация пакета в npm и дополнительные полномочия не требуются.
