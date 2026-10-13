/** Return a short, safe explanation to the component that owns the failed action.
 * @see ../../docs/product/design-system.md#error-feedback */
export function reportUiError(cause: unknown, _context: string): string {
  const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
  const safeNetworkMessage = cause instanceof Error && /^(?:Связь с Яндекс\.Диском не восстановилась|Яндекс\.Диск просит подождать|Ссылка загрузки устарела|Яндекс\.Диск отклонил (?:файл|фото): HTTP (?:408|423|425|429|5\d\d))/.test(cause.message)
    ? cause.message : null
  const detail = code === 'unsupported-data-schema' ? DATA_UPDATE_MESSAGE : safeNetworkMessage ?? (code === 'permission-denied' || code === 'auth/permission-denied' ? 'Нет доступа. Проверьте личную ссылку.'
    : code === 'unavailable' || code === 'auth/network-request-failed' || code === 'deadline-exceeded' ? 'Нет связи с Firebase. Проверьте интернет и повторите действие.'
      : code === 'unauthenticated' || code === 'auth/user-token-expired' ? 'Сеанс входа закончился. Откройте личную ссылку снова.'
        : code === 'resource-exhausted' ? 'Сервис временно занят. Повторите действие чуть позже.'
          : code ? 'Не удалось получить данные. Повторите действие.'
            : 'Действие не выполнено. Повторите попытку.')
  return detail
}
import { DATA_UPDATE_MESSAGE } from './dayCompatibility'
