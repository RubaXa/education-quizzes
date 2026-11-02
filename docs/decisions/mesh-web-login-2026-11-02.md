---
id: decision.mesh-web-login-2026-11-02
status: accepted
implementation: partial
created: 2026-11-02
updated: 2026-11-02
parent: module.school-diary
uses:
  - shared.server-runtime
consumers:
  - parent
  - local diary operator
  - shared Mesh session
code:
  - packages/education-connect/lib/web-login.mjs
  - packages/education-connect/lib/mesh.mjs
  - packages/education-connect/lib/http-trace.mjs
  - packages/education-connect/lib/prompts.mjs
  - packages/education-connect/lib/login-diagnostics.mjs
  - packages/education-runtime/credentials.mjs
  - diary/login.mjs
  - diary/cli.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Прямой парольный CLI-вход через веб-клиент дневника

## Основание

Родитель02.11 потребовал восстановить CLI: сначала телефон/email/СНИЛС и пароль,
затем вход, при необходимости SMS, с полной маскированной трассой. Ленивый ввод129
мешал этому сценарию. Мобильная регистрация SDK отклоняется400access_denied.

Проверен публичный OAuth-init существующего веб-клиента dnevnik.mos.ru:
GET /sps/oauth/ae с display=script вернул200JSON choose_one/login_with_password
и proofOfWork, без регистрации нового приложения и без credentials.
Первичный контракт: https://docs.identityblitz.ru/5.31/integration-guide/authentication-api.html .
CookieJar следует https://github.com/salesforce/tough-cookie .

## Было → стало

Прямой `npm run mesh:login` сначала спрашивает credentials в TTY и по умолчанию
использует существующий веб-клиент дневника, а не dynamic mobile register.
`--method mobile` явно сохраняет прежний SDK-маршрут для сравнения. Нет скрытого
перебора способов входа, replay пароля или автоматической повторной отправки SMS.
Трасса включена npm-командой по умолчанию; секреты2символа+звёздочки+длина.

Новый HTTP-драйвер сохраняет собственные cookies в RFC6265 CookieJar, использует
headless form POST по документации, proof-of-work, запрос SMS и код пользователя.
OAuth state проверяется перед точным callback school.mos.ru/v3/auth/sudir/callback;
только HTTPS login.mos.ru/school.mos.ru/dnevnik.mos.ru, ограниченное число переходов.
Пароль отправляется исключительно в login.mos.ru/sps/login/methods/headless/password.
CAPTCHA/неподдержанный фактор останавливаются с точной причиной, не обходятся.
Подтверждение доверия запрашивается отдельно в CLI, не принимается молча.

Токен из cookie собственной новой CLI-сессии проходит прежнюю серверную проверку
родителя/ребёнка и совпадения владельца. Existing secret заменяется только после
успеха. Browser cookies не извлекаются. CookieJar остаётся в существующем закрытом
secret.json0600. Подход не требует чужого client_secret или новой регистрации.

При401 adapter может обновить токен через сохранённую собственную SSO-сессию,
пока провайдер разрешает это без нового интерактива. Ротация cookie сохраняется
под прежним account lock. При требовании пароля/SMS возвращается auth-required;
пароль не сохраняется и автоматически не используется. Бессрочный доступ не обещается.

## Действия и роли

Реальные пароль/SMS вводит пользователь только в терминале. Никакого handoff/Firebase
при входе, новых семейных прав, отключения TLS или авторизации от имени ребёнка.
Неудача сохраняет прежний источник. Веб-инициализация200 подтверждает лишь доступность
формы протокола; успех login, renewal и42-дневного сбора требуют отдельных live-проверок.

## Проверки

Фикстуры: пароль/SMS/callback, правильный и неверный state, scope cookies по доменам,
redirect на неизвестный host, истёкшая SSO без скрытых credentials, отказ пароля,
выбор профиля и сохранение прежней семьи. PTY проверяет порядок ввода реального CLI,
скрытый пароль/SMS и трассировку. Hashcash проверяется по ведущим нулевым битам.
Полный check и hooks обязательны. PTY обнаружил и устранил гонку эха: raw mode
включается до вывода приглашения скрытого ввода. Legacy credential codec сохраняет
в памяти ротацию cookie, а не откатывает её к первоначальному объекту. Новую регистрацию и реальные credentials тесты не посылают.

## Согласование

Прямой запрос родителя02.11 восстановить телефон/СНИЛС/пароль/SMS login CLI и изучить
документацию/библиотеки; прежний ввод-после-регистрации в прямом CLI заменён этим
более новым требованием. Прежний invite-коннектор не переопределяется.

### Исправление подтверждения доверия

Реальный пользовательский запуск02.11 подтвердил парольный HTTP200, SMS challenge,
успешный SMS303 и выдачу SSO cookies. Он также выявил дефект: после согласия CLI
повторял GET askToTrust с тем же HTML, не отправляя выбранную форму. Это не
подтверждает callback, Mesh token или сохранение доступа.

Теперь HTML разбирается parse5 без выполнения scripts. Только единственная
однозначная положительная submit-кнопка формы на точном HTTPS login.mos.ru
askToTrust, её method/action и hidden-поля могут отправляться после согласия.
Пароль, логин и SMS не копируются в trust POST. Неизвестная/неоднозначная форма
останавливается, сторонние actions отвергаются. Повтор HTML после единственного
решения даёт ошибку trust/unexpected-response, без повторных согласий.
Тесты воспроизводят исходный цикл, проверяют отправку полей, HTML entities,
отказ/неизвестную форму и запрет стороннего action. Точный HTML реальной
авторизованной страницы в маскированной трассе отсутствует; живое завершение
после исправления всё ещё требует пользовательского запуска.
