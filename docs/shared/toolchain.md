---
id: shared.toolchain
status: accepted
implementation: partial
parent: product.education
uses:
  - shared.specification-system
sections:
  - действующий-запуск
  - ограничения

created: 2026-10-16
updated: 2026-10-22
consumers:
  - "frontend developer"
  - "repository maintainer"
  - "operator"
code:
  - "vite.config.ts"
---

# Toolchain и конфигурация репозитория

Источник списка зависимостей и команд — `package.json`, зафиксированных версий — `package-lock.json`. Клиент использует React/TypeScript/Vite/Firebase Web SDK; операторские CLI — Node ESM, общий server runtime и прямой Google Cloud Firestore SDK; Firebase Admin остаётся dev-инструментом совместимости; МЭШ изолирован через `mesh-diary`. Telegram worker использует grammY, auto-retry и тот же server Firestore bootstrap; его live/deployment статус описан в операционном контракте.

## Действующий запуск

`npm ci` устанавливает lock-файл; `npm run dev` запускает интерфейс; `npm run typecheck`, `npm run check:spec`, `npm run check:reads`, `npm run lint`, `npm run test`, `npm run build` проверяют соответствующие границы. `npm run check` объединяет штатные gates. Браузерная регрессия photo outbox входит в обычный Vitest/check и требует установленный Chromium: переменная `CHROME_BIN` задаёт путь к бинарнику; на Mac поддержан установленный Google Chrome, на Linux — `/usr/bin/google-chrome` или `/usr/bin/chromium`. Отсутствие браузера завершает проверку ошибкой, без молчаливого skip. Используются отдельный временный профиль и перехваченный транспорт, без production credentials. Git hooks заданы в `lefthook.yml`; Conventional Commits — в `commitlint.config.cjs`.

Конфигурация МЭШ описана в `.env.example`; `.env.local` и `.local` исключены из Git. Service account keys, реальные работы и материалы не входят в repo. Имена настроек не заменяют протокол secret storage каждого процесса.

## Ограничения

Node закреплён в `.nvmrc` как24.21.0, engines —24.x начиная с этой patch; `nvm install && nvm use` выбирают версию. Выбрана [линейка24 LTS](https://github.com/nodejs/Release#release-schedule), установленная из официального архива с проверкой checksum. Команды checks/bench/deploy выполняются этим Node, installer сохраняет абсолютный process.execPath. Python3/fcntl нужен для общей account lock на macOS/Linux. Прочие хосты требуют отдельного LockPort adapter. Наличие runtime файлов и успешные unit tests не доказывают живой deployment.

### Playwright

`npm run test:e2e` запускает отдельный локальный Vite и изолированный Chromium с синтетическими примерами UI Kit. При первом запуске требуется `npx playwright install chromium`; существующий исполняемый файл Chromium можно указать через `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Текущие сценарии проверяют представления ролей и управление макетом; они не подтверждают реальную публикацию, запись в Firestore или работу EducationSync. Проверки правил доступа выполняются отдельно на эмуляторах Auth и Firestore.


`npm test` запускает Vitest без каталога `e2e/`: сценарии Playwright имеют
собственный runner `npm run test:e2e`, а не исполняются второй раз как unit tests.

Общий Vitest ограничен четырьмя workers, чтобы параллельная трансформация сотен
файлов не лишала headless Chrome времени на запуск в геометрических регрессиях.
