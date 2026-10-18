---
id: decision.authenticated-learning-routes-2026-10-18
status: accepted
implementation: not-applicable
created: 2026-10-18
updated: 2026-10-18
parent: module.families.access-and-state
uses:
  - module.school-diary.dashboard
  - module.reviews.problem-card-design-decisions
consumers:
  - parent
  - student
  - Education operator
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Один учебный адрес, роль из авторизованного членства

## Основание

Родитель открыл общий по смыслу календарь через прежний ученический URL и получил загрузку фото/запрос ориентира вместо закрытого маршрута. Роутер App выбирал parent по строке адреса, тогда как сессия отдельно определяла права на guides. Отсутствие guide само по себе не показывает upload: снимок доказывал parent=false. Пользователь18.10 прямо потребовал одинаковые ссылки и роль по авторизации. Прежняя таблица маршрутов противоречила этому запросу и заменена.

## Было → стало

src/App.tsx больше не вычисляет роль учебных экранов из day-parent/days-parent. src/components/LearningRoute.tsx и src/lib/learningRoute.ts сопоставляют ресурс с конкретным familyId/childId профиля, подтверждают grant/device/member и выбирают внутренний документ роли. src/lib/personalAccess.ts хранит aliases и нормализует сохранённый общий маршрут; старые links совместимы, но не повышают роль.

day/learning-route-identity.mjs — общее ядро идентичности/проверки; scripts/day.mjs и scripts/family.mjs публикуют viewTokens/canonicalToken и shortcuts aliases, не меняя учебную работу. day/dashboard-index.mjs задаёт канонические адреса подробных дней. src/lib/dayDashboardStore.ts типизирует эти поля. src/DayDashboard.tsx, src/DayPage.tsx, src/components/ParentHome.tsx и src/components/NotificationBell.tsx создают общие переходы. scripts/firestore-read-index.mjs классифицирует новый resolver в access группе; каждое новое чтение обосновано в реестре.

## Действия и роли

Один общий /days или /day адрес: родителю доступны подготовленные этапы/источники и проверенная работа; upload и запрос ориентира ему не показываются. Ребёнку доступны свои upload/запрос и отправленная помощь, закрытый полный маршрут не читается. При неподтверждённой/отозванной сессии нет ученического default и нет подмены роли. Подготовленные guides и Firestore rules не ослабляются. Личный секрет входа остаётся персональным: общая учебная ссылка не является входом за другого человека.

## Проверки

src/components/LearningRoute.integration.test.tsx проводит одну ссылку под двумя сессиями через реальный ProblemTaskCard; проверяет отсутствие запрещённых контролов/ответа, ожидание серверной проверки, вход, исторический alias и отзыв. src/lib/learningRoute.test.ts проверяет точного ребёнка, смешанные роли разных семей и чужой ресурс. day/learning-route-identity.test.mjs проверяет общий ресурс, mapping и readback. Существующие src/components/ProblemTaskCard.contract.test.tsx, src/DayDashboard.warmStart.test.tsx, src/components/ParentHome.readBudget.test.tsx и src/lib/personalAccess.readBudget.test.ts сохраняют карточку/бюджет, обновляя только старые ожидания role-prefixed URL. Прежние моки parent=true доказывали компонент, но не связку адрес→сессия→карточка; поэтому старый полный gate не поймал этот дефект.

## Согласование

Прямое уточнение родителя18.10.2026: «Родитель нужно определять не по ссылке, а по роли моей авторизационной. Не должно быть разных ссылок, ссылки у всех должны быть одинаковы». Это разрешение исправить ролевую маршрутизацию без изменения дизайна. Данные aliases выпускаются до PWA; публикация и реальная проверка обеих авторизаций остаются отдельными фактами, а не выводом из unit tests.
