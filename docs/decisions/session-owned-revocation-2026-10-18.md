---
id: decision.session-owned-revocation-2026-10-18
status: accepted
implementation: implemented
created: 2026-10-18
updated: 2026-10-18
consumers:
  - "Education developer"
  - "parent"
  - "student"
code: []
parent: module.families
uses:
  - module.families.access-and-state
  - module.families.browser-access-trace
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Старый callback не удаляет новый вход

## Основание

Пользователь18.10 отказался от ручного Console-сбора и требует самостоятельного воспроизведения для родителя и ребёнка. Доступ к Chrome явно разрешён, но native tool сообщил Computer Use permissions are not granted; обхода и фактической трассы этой вкладки нет.

На исходниках f71a3bc два новых RED теста реального PersonalEntry/personalAccess воспроизвели: новый контекст уже сохранён другой вкладкой, но StorageEvent ещё не доставлен; старый device listener видит другой linkToken, трактует это как отзыв и безусловно удаляет новый context. Обе стороны перехода потеряли сохранённый вход (ожидался new-parent/new-student, получен undefined). LDD показал device mismatch → context-cleared → role none. Это доказанный дефект данного порядка событий, не доказательство единственной причины пользовательского Chrome.

## Было → стало

`src/lib/personalAccess.ts`: clearPersonalSession принимает ожидаемую сессию владельца callback; другой сохранённый вход остаётся, старая память/чтения инвалидируются и наблюдатели принимают актуальный профиль. Это сравнение перед очисткой, не распределённая атомарная транзакция localStorage.

`src/components/PersonalEntry.tsx`: отзыв grant/device, ошибка членства и пустое старое восстановление передают владельца очистки. `src/components/LearningRoute.tsx` делает то же для календаря/дня. `src/lib/browserAccessTrace.ts` допускает точный reason stale-revocation-ignored.

## Действия и роли

Никаких новых экранов/кнопок, изменения URL, новых полномочий или скрытого повышения ученика. Сохранённый профиль проходит прежнюю проверку UID и фоновую сверку. Реальный отзыв текущего входа очищает его. Доступ и приватные guide остаются в доверенных правилах. Нет новых Firestore чтений или изменений Rules.

## Проверки

`src/components/PersonalEntry.localFirst.test.tsx`: два RED→GREEN для замены ребёнок→родитель/родитель→ребёнок до StorageEvent. `src/components/LearningRoute.weekend.integration.test.tsx` теперь использует настоящий personalAccess и learningRoute; подменён готовый профиль/ответ роли больше не возвращается. Имитируются внешние Firestore/data adapters. Матрица: обе роли, холодный device→grant→profile без cache, противоположный устаревший cache, старые device/grant/member callbacks до/после StorageEvent, текущий настоящий отзыв, публикация review и неизменный общий URL. Реальные DayDashboard→WeekendMathSlot→ProblemTaskCard→ParentTaskGuide/WorkReview проверяют родительский разбор и отсутствие загрузки, либо ученическую загрузку и отсутствие закрытого ответа. Прочие identity-race/read-budget/route tests сохраняются.

## Согласование

Прямое поручение внедрить LDD, самостоятельно эмулировать обе роли и исправить причину, не перекладывая Console на пользователя. Исправляется воспроизведённое нарушение владения очисткой сессии. Наблюдение конкретного Chrome и закрытие исходного симптома остаются отдельным уровнем evidence.
