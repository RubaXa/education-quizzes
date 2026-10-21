---
id: decision.upload-photo-timestamp
status: accepted
implementation: implemented
created: 2026-10-21
updated: 2026-10-21
consumers:
  - "Education parent and student UI"
  - "frontend developer"
code:
  - "src/UiKit.tsx"
  - "src/components/ArtifactAvatar.css"
  - "src/components/ArtifactAvatar.tsx"
  - "src/components/LinkedWorkPhotos.css"
  - "src/components/LinkedWorkPhotos.tsx"
  - "src/components/WorkPhotoGallery.tsx"
  - "src/lib/uploadTimestamp.ts"
parent: module.school-diary.day-page
uses:
  - shared.design.components
  - shared.design.ui-kit
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Время загрузки фото

## Основание

Запрос пользователя 21.10.2026: у загруженных ребёнком фотографий отсутствует информация о времени добавления, включая подсказку и доступное имя.

## Было → стало

Общая галерея и ссылки на исходные фото показывают время в title и aria-label миниатюры; при раскрытии фото видна компактная подпись с HTML time. Источник — upload.createdAt: время создания серверной заявки, а не окончания передачи файла. Формат Europe/Moscow с явным «МСК», datetime хранит абсолютное ISO-время. Дата проверки, переноса на Диск, EXIF и время рендера не используются.

Для старых фото без даты время явно неизвестно. Для архивного createdAt написано «Добавлено в архив»; recordedDate не подменяет время загрузки ребёнком. Для ещё не переданного локального фото указано, что время появится после передачи. Для незавершённой серверной заявки написано «Заявка создана».

## Действия и роли

Одинаковая галерея доступна родителю и ученику в рамках прежних разрешений. Подпись раскрытого фото доступна на touch-устройствах. Миниатюры сохраняют компактность, статус, исходный файл и привязку к работе. Дополнительных чтений Firestore нет.

## Проверки

Регрессии formatter проверяют Timestamp, Date, ISO с часовым поясом, неверные значения и переход даты в МСК. Тесты WorkPhotoGallery, LinkedWorkPhotos и UI Kit проверяют title, доступное имя, раскрытый time и честное отсутствие времени. Общие проверки проекта и production-проверка выполняются перед завершением выпуска.

## Согласование

Прямой запрос пользователя 21.10.2026. Реализация выполнена Luna Worker, интеграция и проверка — основным агентом. Выпуск в main по ранее согласованному процессу.
