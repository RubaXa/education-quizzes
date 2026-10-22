---
id: decision.early-development-live-2026-10-22
status: accepted
implementation: partial
created: 2026-10-22
updated: 2026-10-22
parent: module.families.early-development
uses:
  - product.ui-change-control
consumers:
  - Родитель
  - Разработчик и publisher Education
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Рабочий ранний режим и облачный дневник

## Основание

Родитель22.10 утвердил конкретный предпросмотр и поручил подключить ребёнка в рабочем
приложении, чтобы программа и дневник были доступны с телефона. Явно разрешены GitHub
и публикация; после отказа auto-review отдельно разрешены Google Rules API и Firebase.
Условные записи предпросмотра не являются семейными наблюдениями и не импортируются.

## Было → стало

Локальный условный профиль и localStorage → canonical ранний режим с родительской
авторизацией, возрастным планом, общей облачной историей и восстановлением записи.
Существующий Shell, три вкладки и инструкция сохранены. Список детей открывает ранний
раздел непосредственно. Нового школьного календаря, отметок или долга нет.

Семейные книги доступны всем детям семьи, школьное назначение остаётся отдельным.
Новый `earlyChildIds` совместим со старыми клиентами: они продолжают видеть только
школьный список. МЭШ явно исключает раннего ребёнка по canonical learningMode.

## Действия и роли

Только active parent с exact early scope читает план/дневник. Ученик и чужая семья
не получают эти данные даже по общей ссылке. Browser не меняет права, дату рождения
или программу. Родитель создаёт заметку, исправляет, мягко удаляет и восстанавливает;
revision проверяется транзакцией, аудит записывается атомарно и не перезаписывается.
Повторное подключение не создаёт ученика/новый ID и не удаляет дневник.

Затронуты src/App.tsx, src/components/PersonalEntry.tsx, src/components/ParentHome.tsx,
src/components/FamilyAccessCards.tsx, src/components/EarlyDevelopment.tsx,
src/components/EarlyDevelopment.css, src/components/EarlyDevelopmentPage.tsx,
src/lib/personalAccess.ts, src/lib/familyLibrary.ts, src/lib/earlyDevelopment.ts,
src/lib/earlyDevelopmentStore.ts, early-development/program.mjs,
scripts/family.mjs, scripts/lib/early-development.mjs, scripts/check-early-rules.mjs,
scripts/check-early-live.mjs, packages/education-runtime/identity.mjs,
sync/project-plan.mjs и firestore.rules.

## Проверки

Компонентный ежедневный путь и ошибка записи; смешанная семья без школьной подписки
младенца; scope профиля без календаря; отказ школьных требований; CLI с сохранением ID,
неактивного student и существующих наблюдений; повторное подключение; stale revision
без перезаписи, immutable аудит. Google Rules :test20синтетических случаев. После
публикации Rules — реальная изолированная Firebase проверка двух устройств, ученика,
чужой семьи, истории, восстановления и отзыва доступа. Мобильные320/390/540px,
холодное/повторное открытие и адресные production receipts обязательны до заявления о выпуске.

## Согласование

Прямой ответ пользователя: «Да, такой сценарий подходит. Доделывай и подключай …
в рабочем приложении … Разрешаю отправлять код в GitHub и публиковать изменения».
Дополнительное подтверждение: «Да, разрешаю Google/Firebase» в ответ на точный
вопрос о проверке/публикации Rules и подключении профиля с программой.
