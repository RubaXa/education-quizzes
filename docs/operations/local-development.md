---
id: operations.local-development
status: accepted
implementation: implemented
parent: operations
uses:
  - shared.toolchain
  - shared.specification-system
sections: []
created: 2026-10-16
updated: 2026-10-22
consumers:
  - "Education operator"
  - "developer"
  - "release operator"
code:
  - "vite.config.ts"
---

# Локальная разработка

Команды выполняются в корне `education-quizzes`. `npm ci` использует существующий lock, `npm run dev` запускает Vite. Настройки МЭШ берутся из `.env.example`/закрытой `.env.local`, личные пакеты и снимки — из `.local`; публичный clone не включает credentials и учебные данные.

| Изменение | Проверка |
|---|---|
| Структура документов, ссылки и якоря | `npm run check:docs`; pre-commit автоматически проверяет Git index |
| Производный граф и полный контракт спецификаций | `npm run specs:generate`, затем `npm run check:spec` |
| Клиентские типы/код | `npm run typecheck`, соответствующие Vitest tests |
| Новые чтения Firestore | Обоснование в read registry и `npm run check:reads` |
| Перед коммитом/выпуском | Штатный `npm run check`; хуки не обходятся |

Для браузерной регрессии загрузки установите Chromium или задайте `CHROME_BIN=/абсолютный/путь/к/chrome` перед `npm run check`. Тест использует настоящую IndexedDB в изолированном профиле и не обращается в production. На физическом Safari/iPhone тест этим не считается пройденным.

Работа из самостоятельного checkout не требует приватного PETR-графа для чтения общих контрактов. Производственные записи выполняются только профильными операторскими командами с проверкой владельца и readback; запуск dev server не выдаёт доступ к семье.
