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

---

# Toolchain и конфигурация репозитория

Источник списка зависимостей и команд — `package.json`, зафиксированных версий — `package-lock.json`. Клиент использует React/TypeScript/Vite/Firebase Web SDK; операторские CLI — Node ESM и Firebase Admin; МЭШ изолирован через `mesh-diary`. Для будущего Telegram worker установлены grammY, auto-retry и прямой серверный Firestore SDK, но runtime ещё не создан.

## Действующий запуск

`npm ci` устанавливает lock-файл; `npm run dev` запускает интерфейс; `npm run typecheck`, `npm run check:spec`, `npm run check:reads`, `npm run lint`, `npm run test`, `npm run build` проверяют соответствующие границы. `npm run check` объединяет штатные gates. Git hooks заданы в `lefthook.yml`; Conventional Commits — в `commitlint.config.cjs`.

Конфигурация МЭШ описана в `.env.example`; `.env.local` и `.local` исключены из Git. Service account keys, реальные работы и материалы не входят в repo. Имена настроек не заменяют протокол secret storage каждого процесса.

## Ограничения

Версия Node пока не закреплена через `.nvmrc`/`.node-version`; предыдущая установка на Node 26 дала engine warning для транзитивного dev-инструмента. Этот документ фиксирует пробел и не объявляет новый runtime поддержанным без проверки. Host будущего Telegram worker и его production secret manager остаются открытым решением. Метаданные пакета не доказывают deployment.
