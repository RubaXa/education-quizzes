---
id: service.web-app
status: accepted
implementation: partial
parent: product.education
uses:
  - module.families
  - module.school-diary
  - module.assessments
  - module.notifications
  - shared.data.firestore
  - shared.design
  - service.web-app.local-first-sync
  - service.web-app.local-first-verification
  - decisions.local-first-hot-path-decision-2026-10-12
  - shared.data.revisions
sections:
  - спецификации
  - код-и-данные

created: 2026-10-16
updated: 2026-10-16
consumers:
  - "parent"
  - "student"
  - "web-app frontend"
  - "frontend developer"
code:
  - "src/App.tsx"
---

# Клиентское приложение

Клиентская Vite/React PWA подписывается на семейные публикации и отображает день, материалы, проверки и личный inbox. Она не собирает МЭШ и не принимает решения о достоверности учебной работы.

## Спецификации

- [Решение по быстрым маршрутам local-first](../../decisions/local-first-hot-path-decision-2026-10-12.md)
- [Матрица ревизий](../../shared/data/revisions.md)
- [Синхронизация local-first](local-first-sync.md)
- [Проверка перехода на семейные ревизии](local-first-verification.md)

## Код и данные

Веб-приложение запускается через Vite/React PWA. Оно отображает состояние семьи и школьного дня, читая Firestore; синхронизацией оператора и доставкой Telegram оно не управляет.

| Код | Вход → результат | Контракт |
|---|---|---|
| `src/App.tsx` | авторизованный маршрут и подписки → экраны семьи и дня | Оболочка и маршруты; [UI component contract](../../shared/design/components.md) |
| `src/lib/dayStore.ts` | опубликованные документы дня → состояние экрана | Проекция дня и заданий; [school diary](../../modules/school-diary/README.md) |
| `src/lib/quiz.ts` | опубликованная проверка и попытки → ученический тест | Граница данных проверки; [assessment module](../../modules/assessments/README.md) |
| `src/components/NotificationBell.tsx` | личные обновления inbox → список прочитанных и новых | [Inbox contract](../../modules/notifications/inbox.md) |
