---
id: decision.canonical-evidence-and-learning-2026-11-17
status: accepted
implementation: partial
created: 2026-11-17
updated: 2026-11-17
consumers:
  - parent
  - student
parent: shared.design
uses:
  - module.materials.storage-privacy
  - module.school-diary.day-page
  - shared.design.components
  - module.reviews.criteria-and-knowledge
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
code:
  - src/lib/homeworkStatus.ts
  - src/lib/taskUploadPresentation.ts
  - src/WeekendMathSlot.tsx
  - src/lib/reviewPresentation.ts
  - scripts/submissions.mjs
  - storage/review-readback.mjs
  - src/DayPage.tsx
  - src/UiKit.tsx
  - day/decision-registry.mjs
  - src/components/LinkedWorkPhotos.tsx
  - src/components/TaskWorkEvidence.tsx
  - src/components/WorkPhotoGallery.tsx
  - src/components/ProblemCard.tsx
---
# Преемственность карточки и повторная ошибка

## Основание
Прямое требование17.11: ссылки на фото заменить существующими миниатюрами,
снять дубли номера, использовать имеющийся учебник и учесть повторные ошибки.
Ссылочный вид был прописан в прежнем контракте18.10. Текущее решение его отменяет;
владение, исходные файлы и история сохраняются.

## Было → стало
Ссылочный обход → один существующий блок миниатюр. Повтор номера → один номер.
Наблюдение об ошибке → явный агентский переход к тренировке в том же тестовом блоке.

## Действия и роли
day/decision-registry.mjs связывает повторную ошибку с подготовкой обычного теста.
src/DayPage.tsx и src/UiKit.tsx используют те же потребители.
TaskWorkEvidence.tsx объединяет покрытие в одну WorkPhotoGallery.tsx.
readOnlyUploadIds запрещает удаление связанных фото и в полосе, и в раскрытии.
LinkedWorkPhotos.tsx только выбирает данные для той же галереи; проверенный
SourceFragment сохранён. ProblemCard.tsx не повторяет уже имеющийся номер.
Полный ответ родителя и безопасный текущий шаг ребёнка не меняются.

Коррекция после изменения соседнего задания использует тот же адресный reviewTarget
из storage/review-readback.mjs в scripts/submissions.mjs: исходное назначение,
критерии, статус и фото всё равно сверяются. Вложенный номер не теряет родителя.
Общий problemCardHeading в src/lib/reviewPresentation.ts используется в
src/components/ProblemCard.tsx, src/DayPage.tsx, src/WeekendMathSlot.tsx и
src/lib/taskUploadPresentation.ts, включая доступные подписи миниатюр. src/lib/homeworkStatus.ts использует тот же
форматтер в сводке главной страницы, сохраняя название варианта.

## Проверки
TaskWorkEvidence.test.tsx проверяет смешанный набор, устранение дублей ID,
просмотр связанного файла и сохранение удаления своего файла в обоих layout.
LinkedWorkPhotos.test.tsx проверяет источник, кроп и обычную галерею.
ProblemCard.test.tsx проверяет оба варианта заголовка и прежние статусы.
storage/review-readback.test.mjs проверяет тот же номер после правки соседа,
отказ для другого исходного текста и отсутствие неизвестного ID.
Живой выпуск и обе ролевые проекции проверяются отдельно.

## Согласование
Прямой запрос пользователя17.11 и четыре скриншота. Новая композиция,
CSS или повторная передача уже загруженных файлов не разрешались.
